import { describe, expect, it } from 'vitest'
import { fieldTrials } from '../src/main/fieldTrials'

describe('fieldTrials', () => {
  it('always paces big frames faster', () => {
    expect(fieldTrials({ lowLatency: false })).toBe(
      'WebRTC-ProbingScreenshareBwe/10.0,2875,80,40,-60,3/WebRTC-Video-Pacing/factor:10.0/'
    )
  })

  it('adds zero playout delay for Lowest latency, as one well-formed list', () => {
    const trials = fieldTrials({ lowLatency: true })
    expect(trials).toContain('WebRTC-ForcePlayoutDelay/min_ms:0,max_ms:0/')
    // Chromium's format: name/value/ pairs, so an even number of parts before the trailing slash.
    expect(trials.endsWith('/')).toBe(true)
    expect(trials.slice(0, -1).split('/').length % 2).toBe(0)
  })
})
