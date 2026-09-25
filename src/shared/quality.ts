/**
 * Quality ladder and the adaptive controller that walks it.
 *
 * The controller is pure (no WebRTC types) so it can be unit tested and reused
 * by both the WebRTC path (per viewer) and the TCP fallback encoder (shared).
 */

export type QualityPresetId = 'native60' | '1080p60' | '720p60' | '720p30' | '480p30'

export interface QualityPreset {
  id: QualityPresetId
  label: string
  /** Target height in pixels; 0 means "source resolution". */
  height: number
  fps: number
  maxBitrate: number
}

/** Ordered best → worst. */
export const QUALITY_PRESETS: readonly QualityPreset[] = [
  { id: 'native60', label: 'Native @ 60 fps', height: 0, fps: 60, maxBitrate: 20_000_000 },
  { id: '1080p60', label: '1080p @ 60 fps', height: 1080, fps: 60, maxBitrate: 15_000_000 },
  { id: '720p60', label: '720p @ 60 fps', height: 720, fps: 60, maxBitrate: 10_000_000 },
  { id: '720p30', label: '720p @ 30 fps', height: 720, fps: 30, maxBitrate: 5_000_000 },
  { id: '480p30', label: '480p @ 30 fps', height: 480, fps: 30, maxBitrate: 2_500_000 }
]

export function getPreset(id: QualityPresetId): QualityPreset {
  return QUALITY_PRESETS.find((p) => p.id === id) ?? QUALITY_PRESETS[1]
}

/** The presets the controller may use, starting at the user's maximum. */
export function qualityLadder(max: QualityPresetId): QualityPreset[] {
  const start = QUALITY_PRESETS.findIndex((p) => p.id === max)
  return QUALITY_PRESETS.slice(start < 0 ? 1 : start)
}

export interface EncodingParams {
  scaleResolutionDownBy: number
  maxFramerate: number
  maxBitrate: number
}

/** RTCRtpEncodingParameters for a preset given the captured source height. */
export function encodingFor(preset: QualityPreset, sourceHeight: number): EncodingParams {
  const scale = preset.height > 0 && sourceHeight > preset.height ? sourceHeight / preset.height : 1
  return {
    scaleResolutionDownBy: Math.round(scale * 1000) / 1000,
    maxFramerate: preset.fps,
    maxBitrate: preset.maxBitrate
  }
}

/** Output size for an encoder that scales itself (TCP fallback). Dimensions are even. */
export function scaledSize(preset: QualityPreset, width: number, height: number): { width: number; height: number } {
  const scale = preset.height > 0 && height > preset.height ? preset.height / height : 1
  const even = (n: number): number => Math.max(2, Math.round((n * scale) / 2) * 2)
  return { width: even(width), height: even(height) }
}

export interface NetworkSample {
  /** Packet loss over the last interval, in percent. */
  lossPct: number
  rttMs: number | null
  /** WebRTC's outbound-rtp.qualityLimitationReason (or an equivalent). */
  limitation: 'none' | 'cpu' | 'bandwidth' | 'other'
}

export interface AdaptiveOptions {
  /** Ignore bandwidth limitation this long after (re)starting or switching level (BWE ramp-up). */
  warmupMs: number
  /** Consecutive bad samples needed to step down. */
  badSamplesToDegrade: number
  /** Minimum time between two decisions. */
  holdMs: number
  /** Initial time of good samples needed to step up; doubles on each failed step-up. */
  upgradeAfterMs: number
  maxUpgradeAfterMs: number
  /** A step-up that degrades again within this window counts as failed. */
  failedUpgradeWindowMs: number
  lossBadPct: number
  lossGoodPct: number
  rttBadMs: number
  rttGoodMs: number
}

export const DEFAULT_ADAPTIVE_OPTIONS: AdaptiveOptions = {
  warmupMs: 10_000,
  badSamplesToDegrade: 2,
  holdMs: 4_000,
  upgradeAfterMs: 10_000,
  maxUpgradeAfterMs: 120_000,
  failedUpgradeWindowMs: 15_000,
  lossBadPct: 5,
  lossGoodPct: 1,
  rttBadMs: 200,
  rttGoodMs: 100
}

export type AdaptiveDecision = 'up' | 'down' | 'hold'

export class AdaptiveController {
  private level = 0
  private badStreak = 0
  private goodSince: number | null = null
  private lastChange: number
  private lastUpgradeAt: number | null = null
  private upgradeAfter: number
  private readonly opts: AdaptiveOptions

  constructor(
    private readonly ladder: readonly QualityPreset[],
    now: number,
    opts: Partial<AdaptiveOptions> = {}
  ) {
    if (ladder.length === 0) throw new Error('empty quality ladder')
    this.opts = { ...DEFAULT_ADAPTIVE_OPTIONS, ...opts }
    this.upgradeAfter = this.opts.upgradeAfterMs
    this.lastChange = now
  }

  get preset(): QualityPreset {
    return this.ladder[this.level]
  }

  get levelIndex(): number {
    return this.level
  }

  /** Feed one stats sample; returns what changed. */
  update(sample: NetworkSample, now: number): AdaptiveDecision {
    const o = this.opts
    const warmingUp = now - this.lastChange < o.warmupMs
    const bad =
      sample.lossPct > o.lossBadPct ||
      (sample.rttMs !== null && sample.rttMs > o.rttBadMs) ||
      sample.limitation === 'cpu' ||
      (sample.limitation === 'bandwidth' && !warmingUp)
    const good =
      sample.lossPct < o.lossGoodPct &&
      (sample.rttMs === null || sample.rttMs < o.rttGoodMs) &&
      sample.limitation === 'none'

    if (bad) {
      this.badStreak++
      this.goodSince = null
    } else {
      this.badStreak = 0
      if (good) this.goodSince ??= now
      else this.goodSince = null
    }

    if (now - this.lastChange < o.holdMs) return 'hold'

    if (this.badStreak >= o.badSamplesToDegrade && this.level < this.ladder.length - 1) {
      if (this.lastUpgradeAt !== null && now - this.lastUpgradeAt < o.failedUpgradeWindowMs) {
        this.upgradeAfter = Math.min(this.upgradeAfter * 2, o.maxUpgradeAfterMs)
      }
      this.lastUpgradeAt = null
      this.setLevel(this.level + 1, now)
      return 'down'
    }

    if (this.level > 0 && this.goodSince !== null && now - this.goodSince >= this.upgradeAfter) {
      this.lastUpgradeAt = now
      this.setLevel(this.level - 1, now)
      return 'up'
    }

    // Staying healthy for a long time forgives earlier failed upgrades.
    if (this.goodSince !== null && now - this.goodSince >= o.maxUpgradeAfterMs) {
      this.upgradeAfter = o.upgradeAfterMs
    }
    return 'hold'
  }

  /** Restart warm-up, e.g. after the capture source changed. */
  reset(now: number): void {
    this.lastChange = now
    this.badStreak = 0
    this.goodSince = null
  }

  private setLevel(level: number, now: number): void {
    this.level = level
    this.badStreak = 0
    this.goodSince = null
    this.lastChange = now
  }
}

// ---------------------------------------------------------------------------
// Per-watcher limits: what a watcher actually displays, and the streamer's
// total upload budget shared between its watchers.
// ---------------------------------------------------------------------------

/** Heights a watcher's view is rounded up to (keeps renegotiation rare). */
export const VIEW_HEIGHT_STEPS = [360, 480, 720, 1080, 1440, 2160] as const

/** Never ask an encoder for less than this. */
export const MIN_VIDEO_BITRATE = 300_000

/** Round a displayed pixel height up to the next step (null = full quality). */
export function viewHeightStep(pixels: number | null): number | null {
  if (pixels === null || !Number.isFinite(pixels) || pixels <= 0) return null
  return VIEW_HEIGHT_STEPS.find((s) => s >= pixels) ?? null
}

/** What a watcher asks a streamer for; null = no limit. */
export interface ViewLimit {
  /** Height in pixels: what the watcher displays, or its chosen maximum if lower. */
  height: number | null
  /** Frame rate the watcher chose to receive at most. */
  fps: number | null
}

export const NO_VIEW_LIMIT: ViewLimit = { height: null, fps: null }

/**
 * A preset limited to a watcher's view: resolution capped to `view.height`
 * and frame rate to `view.fps`, with the bitrate scaled by the pixel count and
 * frame rate. Height 0 (source resolution) stays 0 when nothing caps it.
 */
export function limitPreset(preset: QualityPreset, sourceHeight: number, view: ViewLimit): QualityPreset {
  const presetHeight = preset.height > 0 ? Math.min(preset.height, sourceHeight) : sourceHeight
  const capped = view.height !== null && view.height < presetHeight
  const height = capped ? view.height! : presetHeight
  const fps = view.fps !== null && view.fps < preset.fps ? view.fps : preset.fps
  if (!capped && fps === preset.fps) return preset
  const maxBitrate = Math.max(MIN_VIDEO_BITRATE, Math.round(preset.maxBitrate * (height / presetHeight) ** 2 * (fps / preset.fps)))
  return { ...preset, height: capped || preset.height > 0 ? height : 0, fps, maxBitrate }
}

/**
 * The combined limit for watchers that share one encode (the TCP fallback):
 * enough for the most demanding of them.
 */
export function largestViewLimit(views: readonly ViewLimit[]): ViewLimit {
  const most = (values: (number | null)[]): number | null =>
    values.length === 0 || values.includes(null) ? null : Math.max(...(values as number[]))
  return { height: most(views.map((v) => v.height)), fps: most(views.map((v) => v.fps)) }
}

export interface WatcherLimits {
  /** Height (pixels) the watcher displays the stream at; null = full quality. */
  viewHeight: number | null
  /** Highest frame rate the watcher wants; null = the preset's. */
  maxFps?: number | null
  /** This watcher's share of the streamer's upload budget (bits/s); null = unlimited. */
  bitrateBudget: number | null
}

/**
 * Encoding for one watcher: the adaptive preset, capped to the resolution
 * the watcher actually displays and the frame rate it chose (bitrate scaled
 * with pixel count and frame rate) and to its share of the upload budget.
 */
export function encodingForWatcher(preset: QualityPreset, sourceHeight: number, limits: WatcherLimits): EncodingParams {
  const limited = limitPreset(preset, sourceHeight, { height: limits.viewHeight, fps: limits.maxFps ?? null })
  const enc = encodingFor(limited, sourceHeight)
  if (limits.bitrateBudget !== null) enc.maxBitrate = Math.max(MIN_VIDEO_BITRATE, Math.min(enc.maxBitrate, limits.bitrateBudget))
  return enc
}

// ---------------------------------------------------------------------------
// A watcher's own quality choice for one stream.
// ---------------------------------------------------------------------------

export type WatchQualityId = 'auto' | '1080p' | '720p' | '720p30' | '480p30' | '360p30'

export interface WatchQuality {
  id: WatchQualityId
  label: string
  /** Highest resolution to receive; null = whatever the tile shows. */
  maxHeight: number | null
  /** Highest frame rate to receive; null = the streamer's. */
  maxFps: number | null
}

export const WATCH_QUALITIES: readonly WatchQuality[] = [
  { id: 'auto', label: 'Auto', maxHeight: null, maxFps: null },
  { id: '1080p', label: '1080p', maxHeight: 1080, maxFps: null },
  { id: '720p', label: '720p', maxHeight: 720, maxFps: null },
  { id: '720p30', label: '720p · 30 fps', maxHeight: 720, maxFps: 30 },
  { id: '480p30', label: '480p · 30 fps', maxHeight: 480, maxFps: 30 },
  { id: '360p30', label: '360p · 30 fps', maxHeight: 360, maxFps: 30 }
]

export function getWatchQuality(id: unknown): WatchQuality {
  return WATCH_QUALITIES.find((q) => q.id === id) ?? WATCH_QUALITIES[0]
}

/** What to ask the streamer for: the smaller of the displayed step and the chosen maximum. */
export function watchLimit(viewStep: number | null, quality: WatchQuality): ViewLimit {
  const height =
    viewStep === null ? quality.maxHeight : quality.maxHeight === null ? viewStep : Math.min(viewStep, quality.maxHeight)
  return { height, fps: quality.maxFps }
}

/**
 * Split an upload budget between watchers fairly (max-min / water-filling):
 * nobody gets more than they can use (`demands`), and what small viewers
 * don't need is shared among the rest. Returns one allocation per demand.
 * A null budget means unlimited: everyone gets their full demand.
 */
export function splitBudget(budget: number | null, demands: readonly number[]): number[] {
  if (budget === null) return [...demands]
  const result = new Array<number>(demands.length).fill(0)
  let remaining = budget
  let open = demands.map((d, i) => ({ d, i })).sort((a, b) => a.d - b.d)
  while (open.length > 0) {
    const share = remaining / open.length
    const satisfied = open.filter((x) => x.d <= share)
    if (satisfied.length === 0) {
      for (const x of open) result[x.i] = share
      break
    }
    for (const x of satisfied) {
      result[x.i] = x.d
      remaining -= x.d
    }
    open = open.filter((x) => x.d > share)
  }
  return result.map((r) => Math.floor(r))
}
