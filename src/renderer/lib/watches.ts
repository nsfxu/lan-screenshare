import type { Participant, Settings } from '../../shared/types'
import { Emitter } from './emitter'
import type { RoomClient } from './roomClient'
import { Subscription } from './subscription'

/** How long a watched stream that ended is resumed automatically if it comes back. */
const RESUME_WINDOW_MS = 30_000

type Events = {
  changed: ReadonlyMap<string, Subscription>
}

/**
 * The streams this participant chose to watch (nothing is watched
 * automatically). Routes relayed TCP packets to the right subscription by the
 * streamer slot the server prefixes, and quietly re-subscribes when a watched
 * streamer comes back shortly after their stream ended (e.g. a brief network
 * drop on their side ends the stream server-side).
 */
export class WatchManager extends Emitter<Events> {
  private readonly subs = new Map<string, Subscription>()
  private readonly recentlyEnded = new Map<string, number>()
  private readonly unsubscribers: (() => void)[]

  constructor(
    private readonly client: RoomClient,
    private settings: Settings
  ) {
    super()
    this.unsubscribers = [
      client.on('binary', (buf) => this.routeBinary(buf)),
      client.on('participants', (list) => this.onParticipants(list))
    ]
  }

  get all(): ReadonlyMap<string, Subscription> {
    return this.subs
  }

  isWatching(streamerId: string): boolean {
    return this.subs.has(streamerId)
  }

  updateSettings(settings: Settings): void {
    this.settings = settings
  }

  watch(streamerId: string): Subscription | null {
    if (streamerId === this.client.selfId) return null
    const existing = this.subs.get(streamerId)
    if (existing) return existing
    this.recentlyEnded.delete(streamerId)
    const sub = new Subscription(this.client, streamerId, this.settings.forceTcp)
    sub.on('state', (state) => {
      if (state !== 'ended' || this.subs.get(streamerId) !== sub) return
      // Keep it resumable for a while, then forget it.
      this.subs.delete(streamerId)
      this.recentlyEnded.set(streamerId, Date.now())
      sub.dispose()
      this.emit('changed', this.subs)
    })
    this.subs.set(streamerId, sub)
    this.emit('changed', this.subs)
    return sub
  }

  unwatch(streamerId: string): void {
    this.recentlyEnded.delete(streamerId)
    const sub = this.subs.get(streamerId)
    if (!sub) return
    this.subs.delete(streamerId)
    sub.dispose()
    this.emit('changed', this.subs)
  }

  dispose(): void {
    for (const sub of this.subs.values()) sub.dispose()
    this.subs.clear()
    this.unsubscribers.forEach((u) => u())
    this.removeAllListeners()
  }

  private routeBinary(buf: ArrayBuffer): void {
    if (buf.byteLength < 2) return
    const slot = new Uint8Array(buf, 0, 1)[0]
    const streamer = this.client.participants.find((p) => p.slot === slot)
    if (streamer) this.subs.get(streamer.id)?.pushBinary(buf.slice(1))
  }

  private onParticipants(list: Participant[]): void {
    const now = Date.now()
    for (const [id, endedAt] of this.recentlyEnded) {
      if (now - endedAt > RESUME_WINDOW_MS || !list.some((p) => p.id === id)) {
        this.recentlyEnded.delete(id)
        continue
      }
      if (list.find((p) => p.id === id)?.stream) this.watch(id)
    }
  }
}
