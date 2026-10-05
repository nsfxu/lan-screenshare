/**
 * Notices for a streamer whose computer or network can't keep up. WebRTC
 * already lowers the quality by itself; these say why, and what to do about it.
 *
 * Pure: fed one sample per stats tick (about once a second) by the publisher.
 */

export type StruggleKind = 'cpu' | 'bandwidth' | 'encoders'
export const STRUGGLE_KINDS: readonly StruggleKind[] = ['cpu', 'bandwidth', 'encoders']

/** One viewer's video sender, as seen in one stats tick. */
export interface SenderSample {
  /** WebRTC's qualityLimitationReason: 'none' | 'cpu' | 'bandwidth' | 'other'. */
  limitation: string
  /** Average encode time per frame (ms), or null if no frame was encoded. */
  encodeMs: number | null
  /** WebRTC's encoderImplementation, e.g. "MediaFoundationVideoEncodeAccelerator" or "libvpx". */
  encoder: string
  /** The frame rate this viewer's quality asks for. */
  targetFps: number
}

/** A condition must hold for this many of the last WINDOW ticks before we say anything. */
const WINDOW = 10
const NEEDED = 8
/** After a notice is shown, the same kind stays quiet for this long (ms), even if it comes back. */
export const STRUGGLE_QUIET_MS = 10 * 60_000

/** Software encoders in Chromium's WebRTC; anything else is a hardware (or platform) encoder. */
const SOFTWARE_ENCODER_RE = /libvpx|openh264|libaom|svt|dav1d|ffmpeg/i

export function isSoftwareEncoder(encoder: string): boolean {
  return SOFTWARE_ENCODER_RE.test(encoder)
}

/** Which conditions hold in one tick (several can). */
export function struggleConditions(senders: readonly SenderSample[]): Set<StruggleKind> {
  const found = new Set<StruggleKind>()
  const active = senders.filter((s) => s.encoder || s.encodeMs !== null)
  if (active.length === 0) return found
  // Encoding slower than the frame budget means frames are being skipped, even
  // before WebRTC reports a CPU limitation.
  if (
    active.some((s) => s.limitation === 'cpu') ||
    active.some((s) => s.encodeMs !== null && s.targetFps > 0 && s.encodeMs > 1000 / s.targetFps)
  ) {
    found.add('cpu')
  }
  // One viewer on bad Wi-Fi is their network, not ours: only warn when every viewer is limited.
  if (active.every((s) => s.limitation === 'bandwidth')) found.add('bandwidth')
  // Some viewers got a hardware encoder and others didn't: the GPU ran out of encoder sessions.
  const software = active.filter((s) => s.encoder && isSoftwareEncoder(s.encoder)).length
  const hardware = active.filter((s) => s.encoder && !isSoftwareEncoder(s.encoder)).length
  if (software > 0 && hardware > 0) found.add('encoders')
  return found
}

/**
 * Remembers recent ticks and decides when a notice is due: when a condition
 * holds most of the time for ~10 s, and not again for STRUGGLE_QUIET_MS after
 * it was shown. Short spikes (a scene change, a keyframe) say nothing.
 */
export class StruggleDetector {
  private readonly history: Set<StruggleKind>[] = []
  private readonly shownAt = new Map<StruggleKind, number>()

  /** Feed one tick; returns a kind to show now, or null. */
  update(senders: readonly SenderSample[], now: number): StruggleKind | null {
    this.history.push(struggleConditions(senders))
    if (this.history.length > WINDOW) this.history.shift()
    // CPU first: an overloaded encoder also makes the other numbers look bad.
    for (const kind of ['cpu', 'encoders', 'bandwidth'] as const) {
      const count = this.history.filter((h) => h.has(kind)).length
      if (count < NEEDED) continue
      const last = this.shownAt.get(kind)
      if (last !== undefined && now - last < STRUGGLE_QUIET_MS) continue
      this.shownAt.set(kind, now)
      return kind
    }
    return null
  }

  /** Whether `kind` still holds (most of the recent ticks), to let a notice disappear once it's fixed. */
  holds(kind: StruggleKind): boolean {
    return this.history.filter((h) => h.has(kind)).length >= WINDOW / 2
  }

  /** Forget recent ticks (sharing stopped, paused, or the source changed). */
  reset(): void {
    this.history.length = 0
  }
}

/** The notice for a kind. `viewers`: how many people watch the stream. */
export function struggleMessage(kind: StruggleKind, viewers: number): string {
  switch (kind) {
    case 'cpu':
      return 'Your computer is struggling to encode your stream, so viewers get a lower quality. A lower quality or closing heavy apps helps.'
    case 'bandwidth':
      return viewers > 1
        ? `Your upload can't keep up with ${viewers} viewers, so they get a lower quality. A lower quality, an upload limit (Settings) or a wired connection helps.`
        : "The network can't keep up with your stream, so it's sent at a lower quality. A lower quality or a wired connection helps."
    case 'encoders':
      return 'Your graphics card ran out of hardware encoders, so some viewers are encoded by your CPU instead. If your computer slows down, a lower quality helps.'
  }
}
