import type { SystemStats, Transport } from './types'

// Measuring mode (`npm run perf`, see docs/en-US/testing.md#measuring-performance).
// Nothing here runs unless the app was started with one of the switches below.

/** What the measuring switches asked for. */
export interface PerfOptions {
  /** `--perf-log=<file>`: append one JSON line per second per stream to this file. */
  logFile: string | null
  /** `--perf-view-height=<px>`: report this height for every watched stream instead of the tile's. */
  viewHeight: number | null
}

/** The part of PerfOptions the renderer needs (it never sees the file path). */
export interface PerfRendererOptions {
  logging: boolean
  viewHeight: number | null
}

/** Same range the server accepts in `view-size`. */
const VIEW_HEIGHT_MIN = 90
const VIEW_HEIGHT_MAX = 8640

export function parsePerfArgs(argv: readonly string[]): PerfOptions {
  const value = (name: string): string | null => {
    const arg = argv.find((a) => a.startsWith(`--${name}=`))
    return arg ? arg.slice(name.length + 3) : null
  }
  const logFile = value('perf-log') || null
  const height = Number(value('perf-view-height'))
  const viewHeight =
    Number.isInteger(height) && height >= VIEW_HEIGHT_MIN && height <= VIEW_HEIGHT_MAX ? height : null
  return { logFile, viewHeight }
}

/** The streamer's side of one watcher's connection, in one second. */
export interface PerfSenderRow {
  /** The watcher's display name (the perf script names them "Viewer 1", …). */
  watcher: string
  transport: Transport
  /** `encoderImplementation`, or "WebCodecs" for the shared TCP encoder. */
  encoder: string
  hardware: boolean
  fps: number | null
  width: number
  height: number
  /** For TCP, the shared encoder's total. */
  bitrateKbps: number
  encodeMs: number | null
  limitation: string
  rttMs: number | null
  /** The watcher can't see the stream, so it gets no video (see HIDDEN_VIEW). */
  hidden: boolean
}

export interface PerfStreamerSample {
  kind: 'streamer'
  /** Wall clock, ms since 1970: the instances of one run share the computer's clock. */
  t: number
  watchers: PerfSenderRow[]
  system: SystemStats
}

/** One watched stream, from the watcher's side, in one second. */
export interface PerfWatcherSample {
  kind: 'watcher'
  t: number
  streamer: string
  transport: Transport
  fps: number
  width: number
  height: number
  /** The app's glass-to-glass estimate (see subscription.ts). */
  latencyMs: number | null
  /** Average jitter buffer delay of the frames shown in the last second (WebRTC only). */
  jitterBufferMs: number | null
  /** Cumulative since the connection started (WebRTC only). */
  freezeCount: number | null
  freezeSeconds: number | null
  framesDropped: number
  decoder: string
  bitrateKbps: number
  packetLossPct: number
}

export type PerfSample = PerfStreamerSample | PerfWatcherSample
