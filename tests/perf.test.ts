import { describe, expect, it } from 'vitest'
import { parsePerfArgs, type PerfSenderRow, type PerfStreamerSample, type PerfWatcherSample } from '../src/shared/perf'
import { parsePerfLog, percentiles, summarize, summaryMarkdown, type PerfLog } from '../src/shared/perfSummary'

describe('parsePerfArgs', () => {
  it('is off without the switches', () => {
    expect(parsePerfArgs(['electron', '.', '--profile=a'])).toEqual({ logFile: null, viewHeight: null, highFps: false })
  })

  it('reads the log file and a view height in the range the server accepts', () => {
    expect(parsePerfArgs(['--perf-log=C:\\perf\\a b.jsonl', '--perf-view-height=1080'])).toEqual({
      logFile: 'C:\\perf\\a b.jsonl',
      viewHeight: 1080,
      highFps: false
    })
    expect(parsePerfArgs(['--perf-high-fps']).highFps).toBe(true)
    expect(parsePerfArgs(['--perf-view-height=89']).viewHeight).toBeNull()
    expect(parsePerfArgs(['--perf-view-height=8641']).viewHeight).toBeNull()
    expect(parsePerfArgs(['--perf-view-height=720.5']).viewHeight).toBeNull()
    expect(parsePerfArgs(['--perf-view-height=']).viewHeight).toBeNull()
    expect(parsePerfArgs(['--perf-log=']).logFile).toBeNull()
  })
})

describe('percentiles', () => {
  it('interpolates between the nearest values', () => {
    const values = Array.from({ length: 101 }, (_, i) => 100 - i) // 0…100, unsorted
    expect(percentiles(values)).toEqual({ p5: 5, p50: 50, p95: 95 })
    expect(percentiles([10, 20])).toEqual({ p5: 10.5, p50: 15, p95: 19.5 })
    expect(percentiles([7])).toEqual({ p5: 7, p50: 7, p95: 7 })
  })

  it('has no answer without values', () => {
    expect(percentiles([])).toBeNull()
  })
})

describe('parsePerfLog', () => {
  it('skips blank, cut-off and foreign lines', () => {
    const line = JSON.stringify(watcherSample(1000, {}))
    const log = parsePerfLog('Viewer 1', `${line}\n\n{"kind":"other","t":1}\n${line.slice(0, 20)}`)
    expect(log.instance).toBe('Viewer 1')
    expect(log.samples).toHaveLength(1)
  })
})

const system = { cpuPercent: 10, memoryMB: 300, computerCpuPercent: 40, computerMemoryMB: 8000, computerMemoryTotalMB: 16000 }

function sender(watcher: string, encoder: string, hardware: boolean, extra: Partial<PerfSenderRow> = {}): PerfSenderRow {
  return {
    watcher,
    transport: 'webrtc',
    encoder,
    hardware,
    fps: 60,
    width: 1920,
    height: 1080,
    bitrateKbps: 8000,
    encodeMs: 4,
    limitation: 'none',
    rttMs: 1,
    hidden: false,
    ...extra
  }
}

function streamerSample(t: number, watchers: PerfSenderRow[], cpu = 10): PerfStreamerSample {
  return { kind: 'streamer', t, watchers, system: { ...system, cpuPercent: cpu } }
}

function watcherSample(t: number, extra: Partial<PerfWatcherSample>): PerfWatcherSample {
  return {
    kind: 'watcher',
    t,
    streamer: 'Streamer',
    transport: 'webrtc',
    fps: 60,
    width: 1920,
    height: 1080,
    latencyMs: 30,
    jitterBufferMs: 5,
    freezeCount: 0,
    freezeSeconds: 0,
    framesDropped: 0,
    decoder: 'D3D11VideoDecoder',
    bitrateKbps: 8000,
    packetLossPct: 0,
    ...extra
  }
}

describe('summarize', () => {
  // Viewer 2 got a software encoder: the GPU ran out of sessions.
  const streamer: PerfLog = {
    instance: 'Streamer',
    samples: [0, 1, 2, 3].map((i) =>
      streamerSample(1000 * i, [sender('Viewer 1', 'NvencH264', true), sender('Viewer 2', 'libvpx', false, { encodeMs: 12 })], 10 + i)
    )
  }
  const viewer1: PerfLog = {
    instance: 'Viewer 1',
    samples: [0, 1, 2, 3].map((i) => watcherSample(1000 * i, { fps: 58 + i, latencyMs: 20 + i * 10 }))
  }
  const viewer2: PerfLog = {
    instance: 'Viewer 2',
    samples: [
      watcherSample(0, { fps: 30, freezeCount: 1, freezeSeconds: 0.5, framesDropped: 2 }),
      watcherSample(1000, { fps: 25, freezeCount: 2, freezeSeconds: 0.8, framesDropped: 5 }),
      // A new connection: the counters start again.
      watcherSample(2000, { fps: 28, freezeCount: 1, freezeSeconds: 0.25, framesDropped: 1 }),
      watcherSample(3000, { fps: 29, freezeCount: 1, freezeSeconds: 0.25, framesDropped: 1 })
    ]
  }

  it('gives each watcher the encoder its streamer used for it', () => {
    const summary = summarize([viewer2, streamer, viewer1])
    expect(summary.watchers.map((w) => [w.watcher, w.encoder, w.hardware])).toEqual([
      ['Viewer 1', 'NvencH264', true],
      ['Viewer 2', 'libvpx', false]
    ])
    expect(summary.hardwareWatchers).toBe(1)
    expect(summary.knownEncoderWatchers).toBe(2)
  })

  it('counts freezes and dropped frames that happened during the run, across reconnects', () => {
    const v2 = summarize([streamer, viewer2]).watchers[0]
    expect(v2.freezes).toBe(2) // 1→2, then a new connection with 1
    expect(v2.freezeSeconds).toBe(0.6)
    expect(v2.framesDropped).toBe(4)
  })

  it('counts the keyframes received during the run', () => {
    const counters = (keyFrames: number) => ({
      keyFrames,
      pli: 0,
      fir: 0,
      nack: 0,
      framesReceived: 0,
      framesDecoded: 0,
      pauseCount: 0,
      jitterBufferTargetMs: null
    })
    const log: PerfLog = {
      instance: 'Viewer 1',
      samples: [1, 1, 2, 2, 3].map((k, i) => watcherSample(1000 * i, { counters: counters(k) }))
    }
    expect(summarize([log]).watchers[0].keyFrames).toBe(2)
    expect(summarize([viewer1]).watchers[0].keyFrames).toBeNull()
  })

  it('leaves out samples outside the window (the warm-up)', () => {
    const summary = summarize([streamer, viewer1], 2000, 3000)
    const v1 = summary.watchers[0]
    expect(v1.seconds).toBe(2)
    expect(v1.fps).toEqual({ p5: 60.05, p50: 60.5, p95: 60.95 })
    expect(summary.streamers[0].appCpu?.p50).toBe(12.5)
  })

  it("has no encoder for a streamer whose log isn't in the run (it was on another computer)", () => {
    const summary = summarize([viewer1])
    expect(summary.watchers[0].encoder).toBe('')
    expect(summary.watchers[0].hardware).toBeNull()
    expect(summary.streamers).toEqual([])
    expect(summaryMarkdown(summary, 'Run')).toContain('0 of 0** watchers (1 without a known encoder)')
  })

  it("ignores what was sent while the watcher couldn't see the stream", () => {
    const hidden: PerfLog = {
      instance: 'Streamer',
      samples: [streamerSample(0, [sender('Viewer 1', 'libvpx', false, { hidden: true, fps: 1 })])]
    }
    const summary = summarize([hidden, viewer1])
    expect(summary.watchers[0].encoder).toBe('')
    expect(summary.streamers[0].sentFps).toBeNull()
  })

  it('writes a table row per watcher and per streamer', () => {
    const md = summaryMarkdown(summarize([streamer, viewer1, viewer2]), '2 viewers')
    expect(md).toContain('# 2 viewers')
    expect(md).toContain('Hardware encoders: **1 of 2** watchers')
    expect(md).toContain('| Viewer 1 | Streamer | webrtc | NvencH264 (hw) | 60 | 58 | 35 ms | 49 ms | 5 ms | 0 (0.0 s) | – | 0 |')
    expect(md).toContain('| Viewer 2 | Streamer | webrtc | libvpx (sw) |')
    expect(md).toContain('| Streamer | 12 % | 13 % | 40 % | 40 % |')
    expect(md).toContain('| Sent fps p50 | Capture fps |')
  })
})
