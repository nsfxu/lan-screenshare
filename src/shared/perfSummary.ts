import type { PerfSample, PerfSenderRow, PerfStreamerSample, PerfWatcherSample } from './perf'

/** The samples one app instance wrote during a run (one JSONL file). */
export interface PerfLog {
  /** The instance's display name ("Streamer", "Viewer 1", …). */
  instance: string
  samples: PerfSample[]
}

export interface Percentiles {
  p5: number
  p50: number
  p95: number
}

/** Linear-interpolated percentiles (p in 0–100); null without values. */
export function percentiles(values: readonly number[]): Percentiles | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number): number => {
    const pos = (p / 100) * (sorted.length - 1)
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
  }
  return { p5: at(5), p50: at(50), p95: at(95) }
}

/** Parses a JSONL perf log; lines that aren't samples (e.g. cut off when the app quit) are skipped. */
export function parsePerfLog(instance: string, text: string): PerfLog {
  const samples: PerfSample[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const s = JSON.parse(line) as PerfSample
      if (s && (s.kind === 'streamer' || s.kind === 'watcher') && typeof s.t === 'number') samples.push(s)
    } catch {
      // a partial last line
    }
  }
  return { instance, samples }
}

export interface WatcherSummary {
  watcher: string
  streamer: string
  transport: string
  /** What the streamer encoded this watcher with (most frequent), and whether it was hardware. */
  encoder: string
  hardware: boolean | null
  /** Frames per second shown by the watcher. */
  fps: Percentiles | null
  latencyMs: Percentiles | null
  jitterBufferMs: Percentiles | null
  /** New freezes during the window, and their total length. */
  freezes: number | null
  freezeSeconds: number | null
  framesDropped: number
  /** Seconds the watcher had samples for. */
  seconds: number
}

export interface StreamerSummary {
  instance: string
  /** The app's CPU and the whole computer's, in percent. */
  appCpu: Percentiles | null
  computerCpu: Percentiles | null
  encodeMs: Percentiles | null
  /** What the streamer sent, frames per second, over every watcher's connection. */
  sentFps: Percentiles | null
}

export interface PerfSummary {
  watchers: WatcherSummary[]
  streamers: StreamerSummary[]
  /** Watchers the streamer encoded with a hardware encoder, of those with a known encoder. */
  hardwareWatchers: number
  knownEncoderWatchers: number
}

/** Most frequent value (ties: the first seen). */
function mode(values: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = ''
  let bestCount = 0
  for (const [v, n] of counts) {
    if (n > bestCount) [best, bestCount] = [v, n]
  }
  return best
}

const numbers = (values: readonly (number | null)[]): number[] =>
  values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

/** Growth of a cumulative counter over the window (it restarts from 0 with a new connection). */
function growth(values: readonly number[]): number {
  let total = 0
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    total += d >= 0 ? d : values[i]
  }
  return total
}

/**
 * Summarizes the samples taken in [from, to] (ms since 1970; the runner leaves
 * out the warm-up): one row per watched stream, joined with what its
 * streamer reported about that watcher, plus one row per streamer.
 */
export function summarize(logs: readonly PerfLog[], from = -Infinity, to = Infinity): PerfSummary {
  const inWindow = <T extends PerfSample>(s: T): boolean => s.t >= from && s.t <= to

  // What each streamer said about each watcher, by watcher name.
  const sent = new Map<string, PerfSenderRow[]>()
  const streamers: StreamerSummary[] = []
  for (const log of logs) {
    const own = log.samples.filter((s): s is PerfStreamerSample => s.kind === 'streamer' && inWindow(s))
    if (own.length === 0) continue
    const rows = own.flatMap((s) => s.watchers.filter((w) => !w.hidden))
    for (const row of rows) {
      const key = `${log.instance}\u0000${row.watcher}`
      sent.set(key, [...(sent.get(key) ?? []), row])
    }
    streamers.push({
      instance: log.instance,
      appCpu: percentiles(own.map((s) => s.system.cpuPercent)),
      computerCpu: percentiles(numbers(own.map((s) => s.system.computerCpuPercent))),
      encodeMs: percentiles(numbers(rows.map((r) => r.encodeMs))),
      sentFps: percentiles(numbers(rows.map((r) => r.fps)))
    })
  }

  const watchers: WatcherSummary[] = []
  for (const log of logs) {
    const byStreamer = new Map<string, PerfWatcherSample[]>()
    for (const s of log.samples) {
      if (s.kind !== 'watcher' || !inWindow(s)) continue
      byStreamer.set(s.streamer, [...(byStreamer.get(s.streamer) ?? []), s])
    }
    for (const [streamer, samples] of byStreamer) {
      const rows = sent.get(`${streamer}\u0000${log.instance}`) ?? []
      const encoder = mode(rows.map((r) => r.encoder).filter(Boolean))
      const freezeCounts = numbers(samples.map((s) => s.freezeCount))
      const freezeSeconds = numbers(samples.map((s) => s.freezeSeconds))
      watchers.push({
        watcher: log.instance,
        streamer,
        transport: mode(samples.map((s) => s.transport)),
        encoder,
        hardware: encoder ? rows.find((r) => r.encoder === encoder)!.hardware : null,
        fps: percentiles(samples.map((s) => s.fps)),
        latencyMs: percentiles(numbers(samples.map((s) => s.latencyMs))),
        jitterBufferMs: percentiles(numbers(samples.map((s) => s.jitterBufferMs))),
        freezes: freezeCounts.length ? growth(freezeCounts) : null,
        freezeSeconds: freezeSeconds.length ? Math.round(growth(freezeSeconds) * 10) / 10 : null,
        framesDropped: growth(samples.map((s) => s.framesDropped)),
        seconds: samples.length
      })
    }
  }
  watchers.sort((a, b) => a.watcher.localeCompare(b.watcher, undefined, { numeric: true }))

  const known = watchers.filter((w) => w.hardware !== null)
  return {
    watchers,
    streamers,
    hardwareWatchers: known.filter((w) => w.hardware).length,
    knownEncoderWatchers: known.length
  }
}

const fmt = (v: number | undefined, digits = 0): string => (v === undefined ? '–' : v.toFixed(digits))

/** The summary as a Markdown report (summary.md). */
export function summaryMarkdown(summary: PerfSummary, title: string): string {
  const lines = [`# ${title}`, '']
  lines.push(
    `Hardware encoders: **${summary.hardwareWatchers} of ${summary.knownEncoderWatchers}** watchers` +
      (summary.knownEncoderWatchers < summary.watchers.length
        ? ` (${summary.watchers.length - summary.knownEncoderWatchers} without a known encoder)`
        : ''),
    ''
  )
  lines.push('## Watchers', '')
  lines.push('| Watcher | Streamer | Transport | Encoder | fps p50 | fps p5 | Latency p50 | Latency p95 | Jitter buffer p50 | Freezes | Dropped |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|')
  for (const w of summary.watchers) {
    const encoder = w.encoder ? `${w.encoder} (${w.hardware ? 'hw' : 'sw'})` : '–'
    const freezes = w.freezes === null ? '–' : `${w.freezes} (${fmt(w.freezeSeconds ?? 0, 1)} s)`
    lines.push(
      `| ${w.watcher} | ${w.streamer} | ${w.transport} | ${encoder} | ${fmt(w.fps?.p50)} | ${fmt(w.fps?.p5)} | ` +
        `${fmt(w.latencyMs?.p50)} ms | ${fmt(w.latencyMs?.p95)} ms | ${fmt(w.jitterBufferMs?.p50)} ms | ` +
        `${freezes} | ${w.framesDropped} |`
    )
  }
  lines.push('', '## Streamers', '')
  lines.push('| Streamer | App CPU p50 | App CPU p95 | Computer CPU p50 | Computer CPU p95 | Encode p50 | Encode p95 | Sent fps p50 |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const s of summary.streamers) {
    lines.push(
      `| ${s.instance} | ${fmt(s.appCpu?.p50)} % | ${fmt(s.appCpu?.p95)} % | ${fmt(s.computerCpu?.p50)} % | ` +
        `${fmt(s.computerCpu?.p95)} % | ${fmt(s.encodeMs?.p50, 1)} ms | ${fmt(s.encodeMs?.p95, 1)} ms | ${fmt(s.sentFps?.p50)} |`
    )
  }
  lines.push('')
  return lines.join('\n')
}
