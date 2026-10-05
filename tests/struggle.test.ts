import { describe, expect, it } from 'vitest'
import { lowerPreset } from '../src/shared/quality'
import {
  STRUGGLE_QUIET_MS,
  StruggleDetector,
  isSoftwareEncoder,
  struggleConditions,
  struggleMessage,
  type SenderSample
} from '../src/shared/struggle'

const HW = 'MediaFoundationVideoEncodeAccelerator (NVIDIA HEVC Encoder MFT)'
const ok: SenderSample = { limitation: 'none', encodeMs: 4, encoder: HW, targetFps: 60 }

describe('struggle conditions', () => {
  it('tells software encoders from hardware ones', () => {
    expect(isSoftwareEncoder('libvpx')).toBe(true)
    expect(isSoftwareEncoder('OpenH264')).toBe(true)
    expect(isSoftwareEncoder('SimulcastEncoderAdapter (libaom)')).toBe(true)
    expect(isSoftwareEncoder(HW)).toBe(false)
  })

  it('finds CPU trouble from the limitation or from encode time over the frame budget', () => {
    expect(struggleConditions([ok])).toEqual(new Set())
    expect(struggleConditions([{ ...ok, limitation: 'cpu' }])).toEqual(new Set(['cpu']))
    expect(struggleConditions([{ ...ok, encodeMs: 20 }])).toEqual(new Set(['cpu']))
    // 20 ms is fine for a viewer who asked for 30 fps.
    expect(struggleConditions([{ ...ok, encodeMs: 20, targetFps: 30 }])).toEqual(new Set())
  })

  it('blames our upload only when every viewer is bandwidth-limited', () => {
    const slow = { ...ok, limitation: 'bandwidth' }
    expect(struggleConditions([slow, ok])).toEqual(new Set())
    expect(struggleConditions([slow, slow])).toEqual(new Set(['bandwidth']))
  })

  it('sees the GPU running out of encoders when hardware and software encoders mix', () => {
    expect(struggleConditions([ok, { ...ok, encoder: 'libvpx' }])).toEqual(new Set(['encoders']))
    // All software (e.g. no hardware encoder for the codec at all) is not a limit being hit.
    expect(struggleConditions([{ ...ok, encoder: 'libvpx' }])).toEqual(new Set())
  })

  it('ignores senders that encoded nothing yet', () => {
    expect(struggleConditions([{ limitation: 'bandwidth', encodeMs: null, encoder: '', targetFps: 60 }])).toEqual(new Set())
  })
})

describe('StruggleDetector', () => {
  const cpu: SenderSample = { ...ok, limitation: 'cpu' }

  it('waits for a lasting problem, then stays quiet for a while', () => {
    const d = new StruggleDetector()
    const results = Array.from({ length: 8 }, (_, i) => d.update([cpu], i * 1000))
    expect(results.slice(0, 7)).toEqual(Array(7).fill(null))
    expect(results[7]).toBe('cpu')
    expect(d.holds('cpu')).toBe(true)
    // Still struggling: no repeat within the quiet period...
    for (let t = 8; t < 30; t++) expect(d.update([cpu], t * 1000)).toBeNull()
    // ...but again after it.
    expect(d.update([cpu], 7000 + STRUGGLE_QUIET_MS)).toBe('cpu')
  })

  it('says nothing about short spikes, and lets go once the problem is gone', () => {
    const d = new StruggleDetector()
    for (let t = 0; t < 30; t++) expect(d.update(t % 3 === 0 ? [cpu] : [ok], t * 1000)).toBeNull()
    for (let t = 30; t < 40; t++) d.update([cpu], t * 1000)
    expect(d.holds('cpu')).toBe(true)
    for (let t = 40; t < 46; t++) d.update([ok], t * 1000)
    expect(d.holds('cpu')).toBe(false)
  })

  it('starts over after a reset', () => {
    const d = new StruggleDetector()
    for (let t = 0; t < 7; t++) d.update([cpu], t * 1000)
    d.reset()
    expect(d.update([cpu], 8000)).toBeNull()
  })
})

describe('struggle notices', () => {
  it('words the upload notice by audience size', () => {
    expect(struggleMessage('bandwidth', 3)).toContain('3 viewers')
    expect(struggleMessage('bandwidth', 1)).toContain("The network can't keep up")
  })

  it('offers the next lower quality, none below the lowest', () => {
    expect(lowerPreset('1080p60')?.id).toBe('720p60')
    expect(lowerPreset('480p30')).toBeNull()
  })
})
