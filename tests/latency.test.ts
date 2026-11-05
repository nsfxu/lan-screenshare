import { describe, expect, it } from 'vitest'
import { isLatencyMode, SmoothingController, zeroPlayoutDelay, type SmoothnessSample } from '../src/shared/latency'

const even: SmoothnessSample = { freezes: 0, packetJitterMs: 1, packetsLost: 0 }
/** A freeze the network caused: packets arrived unevenly in that second. */
const netFreeze: SmoothnessSample = { freezes: 1, packetJitterMs: 8, packetsLost: 0 }

/** Feeds `seconds` samples a second apart from `start`; returns the last target. */
function run(c: SmoothingController, sample: SmoothnessSample, start: number, seconds: number): number {
  let target = c.targetMs
  for (let i = 0; i < seconds; i++) target = c.update(sample, start + i * 1000)
  return target
}

describe('latency modes', () => {
  it('start with zero playout delay unless Smooth is chosen', () => {
    expect(zeroPlayoutDelay('auto')).toBe(true)
    expect(zeroPlayoutDelay('lowest')).toBe(true)
    expect(zeroPlayoutDelay('smooth')).toBe(false)
    expect(isLatencyMode('auto')).toBe(true)
    expect(isLatencyMode('fast')).toBe(false)
  })
})

describe('automatic smoothing', () => {
  it('adds no buffer while a stream plays evenly', () => {
    expect(run(new SmoothingController(), even, 0, 300)).toBe(0)
  })

  it('steps up at once on a freeze, then waits to see whether that was enough', () => {
    const c = new SmoothingController()
    expect(c.update(netFreeze, 0)).toBe(30)
    expect(c.update(netFreeze, 2000)).toBe(30)
    expect(c.update(netFreeze, 5000)).toBe(60)
    expect(run(c, netFreeze, 10_000, 30)).toBe(120)
  })

  it('steps up after a couple of seconds of uneven packets, not one', () => {
    const c = new SmoothingController()
    expect(c.update({ ...even, packetJitterMs: 30 }, 0)).toBe(0)
    expect(c.update(even, 1000)).toBe(0)
    expect(c.update({ ...even, packetJitterMs: 30 }, 2000)).toBe(0)
    expect(c.update({ ...even, packetJitterMs: 30 }, 3000)).toBe(30)
  })

  it("leaves freezes the streamer's side causes alone: a game stalling its capture, a still desktop", () => {
    // Measured: a game share froze twice at its start on a wired LAN, packets within 1 ms.
    expect(run(new SmoothingController(), { freezes: 1, packetJitterMs: 1, packetsLost: 0 }, 0, 60)).toBe(0)
    // A freeze with lost packets is the network's.
    expect(new SmoothingController().update({ freezes: 1, packetJitterMs: 1, packetsLost: 4 }, 0)).toBe(30)
  })

  it('steps back down one level after each calm minute', () => {
    const c = new SmoothingController()
    run(c, netFreeze, 0, 6) // 0 → 30 at 0 s, → 60 at 5 s
    expect(c.targetMs).toBe(60)
    // Calm from 6 s on: a minute later, one step down; another minute, the next.
    expect(run(c, even, 6000, 60)).toBe(60)
    expect(run(c, even, 66_000, 1)).toBe(30)
    expect(run(c, even, 67_000, 59)).toBe(30)
    expect(run(c, even, 126_000, 1)).toBe(0)
    // Trouble in the middle of a calm minute starts it again.
    const d = new SmoothingController()
    d.update(netFreeze, 0)
    run(d, even, 1000, 40)
    d.update({ ...even, packetJitterMs: 8 }, 41_000)
    expect(run(d, even, 42_000, 60)).toBe(30)
    expect(run(d, even, 102_000, 1)).toBe(0)
  })
})
