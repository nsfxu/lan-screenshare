import { AVATAR_MIN_INTERVAL_MS, PROTOCOL_VERSION } from '../../shared/constants'
import type {
  ChatMessage,
  ClientMessage,
  CodecSupport,
  ErrorCode,
  Participant,
  RoomState,
  ServerMessage
} from '../../shared/types'
import { Emitter } from './emitter'

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed'

export interface RoomClientOptions {
  url: string
  clientId: string
  name: string
  pin?: string
  hostToken?: string
  decoders?: CodecSupport[]
  /** Our profile picture (data URL), sent after every welcome. */
  avatar?: string | null
}

export interface ClientError {
  code: ErrorCode | 'connection'
  message: string
  retryAfterMs?: number
  attemptsLeft?: number
}

type Events = {
  state: ConnectionState
  welcome: { selfId: string }
  room: RoomState
  participants: Participant[]
  chat: ChatMessage[]
  error: ClientError
  /** Fatal: the session is over (kicked, room ended, auth failed). */
  closed: { reason: string; code: ErrorCode | 'ended' | 'kicked' | 'connection' }
  message: ServerMessage
  binary: ArrayBuffer
  latency: number
  snapshots: ReadonlyMap<string, string>
  avatars: ReadonlyMap<string, string>
}

const PING_INTERVAL_MS = 2000
const MAX_BACKOFF_MS = 8000
/** Give up reconnecting after this long (server keeps the seat for 30 s). */
const RECONNECT_WINDOW_MS = 60_000

/**
 * WebSocket session with a room: auth, presence, chat, signaling transport,
 * latency / clock-offset measurement, and automatic reconnection that resumes
 * the same seat (no PIN re-entry) after a network drop.
 */
export class RoomClient extends Emitter<Events> {
  selfId = ''
  room: RoomState | null = null
  participants: Participant[] = []
  /** Latest stream previews by participant id. */
  readonly snapshots = new Map<string, string>()
  /** Profile pictures by participant id (ours included). */
  readonly avatars = new Map<string, string>()
  messages: ChatMessage[] = []
  state: ConnectionState = 'connecting'
  /** Round trip to the room server in ms. */
  rttMs: number | null = null
  /** serverClock - localClock in ms (the server runs on the host machine). */
  clockOffsetMs = 0

  private ws: WebSocket | null = null
  private resumeToken: string | undefined
  private pingTimer: number | null = null
  private reconnectTimer: number | null = null
  private backoff = 500
  private disconnectedAt = 0
  private finished = false
  private avatarSentAt = 0
  private avatarTimer: number | null = null

  constructor(private readonly opts: RoomClientOptions) {
    super()
    this.open()
  }

  get isHost(): boolean {
    return !!this.opts.hostToken
  }

  get url(): string {
    return this.opts.url
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  sendBinary(data: ArrayBuffer | Uint8Array): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(data)
    return true
  }

  get bufferedAmount(): number {
    return this.ws?.bufferedAmount ?? 0
  }

  /** Change (or remove) our profile picture, now and after reconnects. */
  setAvatar(image: string | null): void {
    if (image === (this.opts.avatar ?? null)) return
    this.opts.avatar = image
    this.sendAvatar()
  }

  /**
   * Send our current picture (or none). The server ignores changes that come
   * faster than AVATAR_MIN_INTERVAL_MS, so a quick second change waits and
   * then sends whatever is current.
   */
  private sendAvatar(): void {
    const wait = this.avatarSentAt + AVATAR_MIN_INTERVAL_MS + 100 - Date.now()
    if (wait > 0) {
      this.avatarTimer ??= window.setTimeout(() => {
        this.avatarTimer = null
        this.sendAvatar()
      }, wait)
      return
    }
    if (this.send({ type: 'set-avatar', image: this.opts.avatar ?? null })) this.avatarSentAt = Date.now()
  }

  /** Leave on purpose: frees the seat immediately. */
  leave(): void {
    if (this.finished) return
    this.send({ type: 'bye' })
    this.finish('You left the room', 'ended')
  }

  private open(): void {
    this.setState(this.resumeToken ? 'reconnecting' : 'connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(this.opts.url)
    } catch (err) {
      this.finish(`Invalid room address: ${String(err)}`, 'connection')
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      this.send({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        clientId: this.opts.clientId,
        name: this.opts.name,
        pin: this.opts.pin,
        hostToken: this.opts.hostToken,
        resumeToken: this.resumeToken,
        decoders: this.opts.decoders
      })
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        this.emit('binary', ev.data as ArrayBuffer)
        return
      }
      let msg: ServerMessage
      try {
        msg = JSON.parse(ev.data) as ServerMessage
      } catch {
        return
      }
      this.handle(msg)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.stopPing()
      if (this.finished) return
      if (!this.resumeToken) {
        this.finish('Could not connect to the room', 'connection')
        return
      }
      this.disconnectedAt ||= Date.now()
      if (Date.now() - this.disconnectedAt > RECONNECT_WINDOW_MS) {
        this.finish('Lost connection to the room', 'connection')
        return
      }
      this.setState('reconnecting')
      this.reconnectTimer = window.setTimeout(() => this.open(), this.backoff)
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
    }
    ws.onerror = () => {
      // onclose follows and handles it
    }
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        // The server re-sends current previews and pictures after welcoming us.
        this.snapshots.clear()
        this.avatars.clear()
        this.selfId = msg.selfId
        this.resumeToken = msg.resumeToken
        this.room = msg.room
        this.participants = msg.participants
        this.messages = [...msg.history]
        this.backoff = 500
        this.disconnectedAt = 0
        this.setState('connected')
        this.startPing()
        this.emit('welcome', { selfId: msg.selfId })
        this.emit('room', msg.room)
        this.emit('participants', msg.participants)
        this.emit('chat', this.messages)
        this.emit('avatars', this.avatars)
        // Always, so a change made while disconnected (removal too) reaches the room.
        this.sendAvatar()
        break
      case 'room':
        this.room = msg.room
        this.emit('room', msg.room)
        break
      case 'participants':
        this.participants = msg.participants
        // Drop previews of people who left or stopped sharing.
        for (const id of [...this.snapshots.keys()]) {
          if (!msg.participants.some((p) => p.id === id && p.stream)) this.snapshots.delete(id)
        }
        // And pictures of people who left.
        for (const id of [...this.avatars.keys()]) {
          if (!msg.participants.some((p) => p.id === id)) this.avatars.delete(id)
        }
        this.emit('participants', msg.participants)
        break
      case 'chat':
        this.messages = [...this.messages, msg.message].slice(-500)
        this.emit('chat', this.messages)
        break
      case 'snapshot':
        if (msg.image) this.snapshots.set(msg.from, msg.image)
        else this.snapshots.delete(msg.from)
        this.emit('snapshots', this.snapshots)
        break
      case 'avatar':
        if (msg.image) this.avatars.set(msg.from, msg.image)
        else this.avatars.delete(msg.from)
        this.emit('avatars', this.avatars)
        break
      case 'chat-deleted':
        this.messages = this.messages.filter((m) => m.id !== msg.id)
        this.emit('chat', this.messages)
        break
      case 'pong': {
        const now = performance.now()
        const rtt = now - msg.t
        this.rttMs = this.rttMs === null ? rtt : this.rttMs * 0.7 + rtt * 0.3
        const offset = msg.serverTime - (Date.now() - rtt / 2)
        this.clockOffsetMs = this.clockOffsetMs === 0 ? offset : this.clockOffsetMs * 0.8 + offset * 0.2
        this.emit('latency', this.rttMs)
        break
      }
      case 'error':
        this.emit('error', {
          code: msg.code,
          message: msg.message,
          retryAfterMs: msg.retryAfterMs,
          attemptsLeft: msg.attemptsLeft
        })
        if (msg.fatal) this.finish(msg.message, msg.code)
        break
      case 'kicked':
        this.finish('You were removed from the room by the host', 'kicked')
        break
      case 'room-ended':
        this.finish(msg.reason, 'ended')
        break
    }
    this.emit('message', msg)
  }

  private finish(reason: string, code: Events['closed']['code']): void {
    if (this.finished) return
    this.finished = true
    this.stopPing()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.avatarTimer) clearTimeout(this.avatarTimer)
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.setState('closed')
    this.emit('closed', { reason, code })
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return
    this.state = state
    this.emit('state', state)
  }

  private startPing(): void {
    this.stopPing()
    const ping = (): void => void this.send({ type: 'ping', t: performance.now() })
    ping()
    this.pingTimer = window.setInterval(ping, PING_INTERVAL_MS)
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }
}
