import { describe, expect, it } from 'vitest'
import {
  AdaptiveController,
  autoContentHint,
  encodingFor,
  encodingForWatcher,
  getPreset,
  getWatchQuality,
  HIDDEN_VIEW,
  isHiddenView,
  largestViewLimit,
  limitPreset,
  MIN_VIDEO_BITRATE,
  qualityLadder,
  scaledSize,
  splitBudget,
  VIEW_HEIGHT_STEPS,
  viewHeightStep,
  watchLimit,
  WATCH_QUALITIES,
  type NetworkSample
} from '../src/shared/quality'

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

describe('per-watcher limits', () => {
  const p1080 = getPreset('1080p60')

  it('rounds displayed heights up to a step', () => {
    expect(viewHeightStep(null)).toBeNull()
    expect(viewHeightStep(0)).toBeNull()
    expect(viewHeightStep(200)).toBe(360)
    expect(viewHeightStep(700)).toBe(720)
    expect(viewHeightStep(721)).toBe(1080)
    expect(viewHeightStep(5000)).toBeNull() // bigger than any step: full quality
  })

  it('caps resolution and bitrate to what the watcher displays', () => {
    const full = encodingForWatcher(p1080, 1080, { viewHeight: null, bitrateBudget: null })
    expect(full).toMatchObject({ scaleResolutionDownBy: 1, maxBitrate: 15_000_000, maxFramerate: 60 })

    const tile = encodingForWatcher(p1080, 1080, { viewHeight: 360, bitrateBudget: null })
    expect(tile.scaleResolutionDownBy).toBe(3)
    expect(tile.maxBitrate).toBe(Math.round(15_000_000 / 9)) // pixel count / 9
    expect(tile.maxFramerate).toBe(60)

    // A view larger than the preset never raises quality above it.
    const big = encodingForWatcher(p1080, 2160, { viewHeight: 1440, bitrateBudget: null })
    expect(big).toMatchObject({ scaleResolutionDownBy: 2, maxBitrate: 15_000_000 })
  })

  it('applies the upload budget share with a floor', () => {
    expect(encodingForWatcher(p1080, 1080, { viewHeight: null, bitrateBudget: 5_000_000 }).maxBitrate).toBe(5_000_000)
    expect(encodingForWatcher(p1080, 1080, { viewHeight: null, bitrateBudget: 1000 }).maxBitrate).toBe(MIN_VIDEO_BITRATE)
  })

  it('splits a budget fairly, giving small viewers what they need', () => {
    expect(splitBudget(null, [15, 15])).toEqual([15, 15])
    expect(splitBudget(30, [15, 15])).toEqual([15, 15])
    expect(splitBudget(20, [15, 15])).toEqual([10, 10])
    // A small tile needs 2: the other two split what's left.
    expect(splitBudget(30, [15, 2, 15])).toEqual([14, 2, 14])
    expect(splitBudget(100, [])).toEqual([])
    const shares = splitBudget(60_000_000, [15_000_000, 1_666_667, 15_000_000, 15_000_000, 15_000_000])
    expect(shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60_000_000)
    expect(shares[1]).toBe(1_666_667)
  })
})

describe('watcher quality choice', () => {
  const p1080 = getPreset('1080p60')
  const native = getPreset('native60')

  it('asks for the smaller of the displayed size and the chosen maximum', () => {
    expect(watchLimit(null, getWatchQuality('auto'))).toEqual({ height: null, fps: null })
    expect(watchLimit(360, getWatchQuality('auto'))).toEqual({ height: 360, fps: null })
    expect(watchLimit(null, getWatchQuality('720p'))).toEqual({ height: 720, fps: null })
    expect(watchLimit(1080, getWatchQuality('480p30'))).toEqual({ height: 480, fps: 30 })
    expect(watchLimit(360, getWatchQuality('720p30'))).toEqual({ height: 360, fps: 30 })
    expect(getWatchQuality('nonsense').id).toBe('auto')
  })

  it('limits a preset by height and frame rate, scaling the bitrate', () => {
    expect(limitPreset(p1080, 1080, { height: null, fps: null })).toBe(p1080)
    const half = limitPreset(p1080, 1080, { height: null, fps: 30 })
    expect(half).toMatchObject({ height: 1080, fps: 30, maxBitrate: 7_500_000 })
    const small = limitPreset(p1080, 1080, { height: 540, fps: 30 })
    expect(small).toMatchObject({ height: 540, fps: 30, maxBitrate: Math.round(15_000_000 / 4 / 2) })
    // Never raised above the preset or the source.
    expect(limitPreset(p1080, 1080, { height: 1440, fps: 120 })).toBe(p1080)
    // Source resolution stays "0" unless something caps it.
    expect(limitPreset(native, 1440, { height: null, fps: 30 }).height).toBe(0)
    expect(limitPreset(native, 1440, { height: 720, fps: null }).height).toBe(720)
  })

  it('applies a frame-rate choice to a watcher\'s encoding', () => {
    const enc = encodingForWatcher(p1080, 1080, { viewHeight: 720, maxFps: 30, bitrateBudget: null })
    expect(enc).toMatchObject({ scaleResolutionDownBy: 1.5, maxFramerate: 30 })
    expect(enc.maxBitrate).toBe(Math.round(15_000_000 * (720 / 1080) ** 2 * 0.5))
  })

  it('sizes a shared (TCP) encode for its most demanding watcher', () => {
    expect(largestViewLimit([])).toEqual({ height: null, fps: null })
    expect(largestViewLimit([{ height: 360, fps: 30 }, { height: 720, fps: 30 }])).toEqual({ height: 720, fps: 30 })
    expect(largestViewLimit([{ height: 360, fps: 30 }, { height: null, fps: null }])).toEqual({ height: null, fps: null })
  })
})

describe("hidden view (watcher can't see the stream)", () => {
  it('is recognised, and no real view or quality choice looks like it', () => {
    expect(isHiddenView(HIDDEN_VIEW)).toBe(true)
    expect(isHiddenView({ height: null, fps: null })).toBe(false)
    for (const step of VIEW_HEIGHT_STEPS) expect(isHiddenView({ height: step, fps: null })).toBe(false)
    // Whatever a tile measures, it reports a step, never the hidden height.
    for (const px of [1, 50, 90, 200, 359]) expect(isHiddenView({ height: viewHeightStep(px), fps: null })).toBe(false)
    for (const q of WATCH_QUALITIES) {
      for (const step of [null, ...VIEW_HEIGHT_STEPS]) expect(isHiddenView(watchLimit(step, q))).toBe(false)
    }
  })
})

describe('automatic content hint', () => {
  const screen = 'screen:0:0'
  const game = { hidden: true, windowId: 'window:42:0', fullscreen: true, displayId: 'd1' }

  it('is smooth motion while a fullscreen window is in front on the shared screen', () => {
    expect(autoContentHint(game, screen, 'd1')).toBe('motion')
    expect(autoContentHint({ ...game, hidden: false }, screen, 'd1')).toBe('motion') // e.g. a fullscreen video
  })

  it('is sharp text on the desktop, and for fullscreen windows on other screens', () => {
    expect(autoContentHint({ ...game, fullscreen: false }, screen, 'd1')).toBe('detail')
    expect(autoContentHint({ ...game, displayId: 'd2' }, screen, 'd1')).toBe('detail')
    expect(autoContentHint({ hidden: false, windowId: null, fullscreen: false, displayId: null }, screen, 'd1')).toBe('detail')
    expect(autoContentHint(game, screen, null)).toBe('detail')
  })

  it('follows the shared window itself when a window is shared', () => {
    expect(autoContentHint(game, 'window:42:0', null)).toBe('motion')
    expect(autoContentHint({ ...game, fullscreen: false }, 'window:42:0', null)).toBe('detail')
    expect(autoContentHint(game, 'window:7:0', null)).toBe('detail')
  })
})
