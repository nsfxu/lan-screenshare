import { describe, expect, it } from 'vitest'
import { AdaptiveController, encodingFor, getPreset, qualityLadder, scaledSize, type NetworkSample } from '../src/shared/quality'

const good: NetworkSample = { lossPct: 0, rttMs: 5, limitation: 'none' }
const lossy: NetworkSample = { lossPct: 12, rttMs: 20, limitation: 'none' }

function run(c: AdaptiveController, sample: NetworkSample, fromMs: number, toMs: number, stepMs = 1000): number {
  let t = fromMs
  for (; t <= toMs; t += stepMs) c.update(sample, t)
  return t
}

describe('quality presets', () => {
  it('builds a ladder from the chosen maximum downwards', () => {
    expect(qualityLadder('1080p60').map((p) => p.id)).toEqual(['1080p60', '720p60', '720p30', '480p30'])
    expect(qualityLadder('720p30').map((p) => p.id)).toEqual(['720p30', '480p30'])
  })

  it('computes scale-down factors from the source height', () => {
    expect(encodingFor(getPreset('1080p60'), 2160).scaleResolutionDownBy).toBe(2)
    expect(encodingFor(getPreset('720p60'), 1080).scaleResolutionDownBy).toBe(1.5)
    expect(encodingFor(getPreset('1080p60'), 900).scaleResolutionDownBy).toBe(1)
    expect(encodingFor(getPreset('native60'), 1440)).toMatchObject({ scaleResolutionDownBy: 1, maxFramerate: 60 })
  })

  it('computes even output sizes for the WebCodecs encoder', () => {
    expect(scaledSize(getPreset('720p30'), 2560, 1440)).toEqual({ width: 1280, height: 720 })
    expect(scaledSize(getPreset('480p30'), 1366, 768)).toEqual({ width: 854, height: 480 })
    expect(scaledSize(getPreset('1080p60'), 1280, 720)).toEqual({ width: 1280, height: 720 })
  })
})

describe('AdaptiveController', () => {
  it('stays at the top level on a healthy network', () => {
    const c = new AdaptiveController(qualityLadder('1080p60'), 0)
    run(c, good, 0, 60_000)
    expect(c.preset.id).toBe('1080p60')
  })

  it('steps down on sustained packet loss, one level per hold period', () => {
    const c = new AdaptiveController(qualityLadder('1080p60'), 0)
    c.update(lossy, 5000)
    expect(c.update(lossy, 6000)).toBe('down')
    expect(c.preset.id).toBe('720p60')
    // Within the hold time nothing changes.
    expect(c.update(lossy, 7000)).toBe('hold')
    run(c, lossy, 8000, 40_000)
    expect(c.preset.id).toBe('480p30') // bottom of the ladder
  })

  it('ignores a single bad sample', () => {
    const c = new AdaptiveController(qualityLadder('1080p60'), 0)
    c.update(good, 5000)
    c.update(lossy, 6000)
    c.update(good, 7000)
    expect(c.preset.id).toBe('1080p60')
  })

  it('ignores bandwidth limitation during warm-up but reacts after it', () => {
    const c = new AdaptiveController(qualityLadder('1080p60'), 0)
    const bw: NetworkSample = { lossPct: 0, rttMs: 10, limitation: 'bandwidth' }
    run(c, bw, 1000, 9000)
    expect(c.preset.id).toBe('1080p60')
    run(c, bw, 10_000, 12_000)
    expect(c.preset.id).toBe('720p60')
  })

  it('steps down on CPU limitation immediately after warm-up checks', () => {
    const c = new AdaptiveController(qualityLadder('1080p60'), 0)
    const cpu: NetworkSample = { lossPct: 0, rttMs: 10, limitation: 'cpu' }
    run(c, cpu, 4000, 6000)
    expect(c.preset.id).toBe('720p60')
  })

  it('recovers upward after a stable period and backs off after a failed upgrade', () => {
    const c = new AdaptiveController(qualityLadder('1080p60'), 0)
    run(c, lossy, 4000, 6000)
    expect(c.preset.id).toBe('720p60')

    // 10 s of good samples → back up.
    let t = run(c, good, 7000, 17_000)
    expect(c.preset.id).toBe('1080p60')

    // Degrades again quickly → the upgrade counts as failed.
    t = run(c, lossy, t, t + 5000)
    expect(c.preset.id).toBe('720p60')
    const failedAt = t

    // Now 10 s of good is no longer enough (needs 20 s).
    t = run(c, good, failedAt, failedAt + 12_000)
    expect(c.preset.id).toBe('720p60')
    run(c, good, t, failedAt + 22_000)
    expect(c.preset.id).toBe('1080p60')
  })

  it('never goes below the ladder with a single preset', () => {
    const c = new AdaptiveController(qualityLadder('1080p60').slice(0, 1), 0)
    run(c, lossy, 0, 30_000)
    expect(c.preset.id).toBe('1080p60')
  })
})
