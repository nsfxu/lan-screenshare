// How long the streams you watch wait before they're shown (Settings → Advanced → Latency).
//
// WebRTC's zero playout delay (src/main/fieldTrials.ts) shows each frame as soon as it's decoded: half the
// delay of its default on a wired network (50 → 25 ms screen to screen, measured with `npm run perf`). Over
// Wi-Fi or a VPN, frames arrive unevenly and the picture can stutter without a buffer. So with "Automatic"
// every watched stream starts with no buffer and adds one only when it stutters, on its own, while the app
// runs: a viewer can raise its jitter buffer for one stream even under zero playout delay (an 80 ms target
// gave 66 ms screen to screen).

export type LatencyMode = 'auto' | 'lowest' | 'smooth'

export const LATENCY_MODES: readonly LatencyMode[] = ['auto', 'lowest', 'smooth']
export const DEFAULT_LATENCY: LatencyMode = 'auto'

export function isLatencyMode(value: unknown): value is LatencyMode {
  return LATENCY_MODES.includes(value as LatencyMode)
}

/**
 * Whether the app starts with zero playout delay. "Smooth" keeps WebRTC's default smoothing for every stream;
 * that's read at startup, so switching to or from it needs a restart.
 */
export function zeroPlayoutDelay(mode: LatencyMode): boolean {
  return mode !== 'smooth'
}

/** The jitter buffers a stream steps through when it stutters, in ms (0: none). */
export const SMOOTHING_STEPS_MS = [0, 30, 60, 120] as const

/** What one second of a watched stream looked like (from its receiver's getStats). */
export interface SmoothnessSample {
  /** Freezes that started in that second (WebRTC's own count). */
  freezes: number
  /** RTP interarrival jitter, ms: how unevenly packets arrive, whatever the content. */
  packetJitterMs: number | null
  /** Packets lost in that second. */
  packetsLost: number
}

/*
 * Only the network counts. A freeze or uneven frames can also come from the streamer's side (a game that
 * stalls the capture, a still desktop that sends few frames), and a buffer doesn't help with those: a measured
 * game share froze twice at its start on a wired LAN with packets arriving within 1 ms. So a freeze counts
 * only when packets were also arriving unevenly or getting lost in that second.
 */

/** Seconds of uneven packets before a step up. */
const ROUGH_SECONDS = 2
/** Packets arriving this unevenly (ms) are trouble; a wired LAN is around 1 ms. */
const ROUGH_PACKET_JITTER_MS = 15
/** A freeze counts when packets were at least this uneven (ms), or some were lost. */
const FREEZE_PACKET_JITTER_MS = 5
const CALM_PACKET_JITTER_MS = 5
/** A new buffer needs a moment to show whether it's enough. */
const STEP_UP_EVERY_MS = 5_000
/** Calm this long before a step down. */
const STEP_DOWN_AFTER_MS = 60_000

/**
 * Decides one watched stream's jitter buffer under "Automatic": none while packets arrive evenly, one step
 * more when the network makes it stutter (a couple of seconds of uneven packets, or a freeze with uneven or
 * lost packets), one step less after a calm minute.
 */
export class SmoothingController {
  private level = 0
  private roughSeconds = 0
  private lastStep = -Infinity
  private calmSince: number | null = null

  /** The buffer to ask for now, ms. */
  get targetMs(): number {
    return SMOOTHING_STEPS_MS[this.level]
  }

  /** Feed one second (`now` in ms); returns the buffer to ask for. */
  update(s: SmoothnessSample, now: number): number {
    const jitter = s.packetJitterMs ?? 0
    const networkFreeze = s.freezes > 0 && (jitter >= FREEZE_PACKET_JITTER_MS || s.packetsLost > 0)
    const rough = jitter > ROUGH_PACKET_JITTER_MS
    const calm = !networkFreeze && s.packetsLost === 0 && jitter < CALM_PACKET_JITTER_MS
    this.roughSeconds = rough ? this.roughSeconds + 1 : 0
    if (!calm) this.calmSince = null
    else if (this.calmSince === null) this.calmSince = now

    const top = SMOOTHING_STEPS_MS.length - 1
    if ((networkFreeze || this.roughSeconds >= ROUGH_SECONDS) && this.level < top && now - this.lastStep >= STEP_UP_EVERY_MS) {
      this.level++
      this.lastStep = now
      this.roughSeconds = 0
    } else if (
      this.level > 0 &&
      this.calmSince !== null &&
      now - this.calmSince >= STEP_DOWN_AFTER_MS &&
      now - this.lastStep >= STEP_DOWN_AFTER_MS
    ) {
      this.level--
      this.lastStep = now
      this.calmSince = now
    }
    return this.targetMs
  }
}
