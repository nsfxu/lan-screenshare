import { EventEmitter } from 'node:events'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import {
  BINARY_FLAG_KEY,
  BINARY_KIND_AUDIO,
  BINARY_KIND_VIDEO,
  CHAT_HISTORY_LIMIT,
  CHAT_MAX_LENGTH,
  CHAT_RATE_LIMIT,
  HEARTBEAT_INTERVAL_MS,
  MAX_USERS,
  NAME_MAX_LENGTH,
  PORT_SEARCH_RANGE,
  PROTOCOL_VERSION,
  RESUME_GRACE_MS,
  ROOM_NAME_MAX_LENGTH,
  SNAPSHOT_MAX_CHARS,
  SNAPSHOT_MIN_INTERVAL_MS,
  TCP_MAX_BUFFERED_BYTES
} from '../shared/constants'
import type {
  ChatMessage,
  ClientMessage,
  CodecSupport,
  ErrorCode,
  MediaState,
  Participant,
  Privacy,
  RoomInfo,
  RoomState,
  ServerMessage,
  Transport
} from '../shared/types'
import { PinGuard, pinsEqual, randomId, randomToken } from '../utils/crypto'

export interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}

const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} }

export interface RoomServerOptions {
  roomId: string
  name: string
  hostName: string
  privacy: Privacy
  pin: string | null
  hostToken: string
  tls?: { key: string; cert: string } | null
  /** Preferred port; 0 picks any free port. */
  port: number
  bindAddress?: string
  maxUsers?: number
  logger?: Logger
  pinGuard?: PinGuard
}

export interface RoomServerEvents {
  change: [info: RoomInfo]
  ended: [reason: string]
}

/** One watcher's subscription to one streamer. */
interface Subscription {
  watcher: Seat
  transport: Transport
  mediaState: MediaState
  /** TCP fallback: drop video until the next keyframe (after joining or drops). */
  waitingKey: boolean
  lastKeyRequest: number
}

interface Seat {
  participant: Participant
  clientId: string
  ws: WebSocket | null
  ip: string
  resumeToken: string
  graceTimer: NodeJS.Timeout | null
  decoders: CodecSupport[]
  chatTimes: number[]
  /** Watchers of this seat's stream, by watcher id. Empty unless sharing. */
  watchers: Map<string, Subscription>
  /** TCP relay counters for this seat's stream, reported back to it. */
  tcpStats: { sent: number; dropped: number }
  /** Latest preview image of this seat's stream. */
  snapshot: string | null
  lastSnapshotAt: number
}

const HOST_ID = 'host'
const HELLO_TIMEOUT_MS = 10_000
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024
const MAX_SLOTS = 256
const COLORS = ['#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784', '#aed581', '#ffb74d', '#ff8a65', '#a1887f']

/**
 * The per-room relay node, run by the host.
 *
 * - `GET /info` serves public room info for discovery probes.
 * - `/ws` carries auth (PIN), chat, presence, moderation, and — for any
 *   participant who shares — WebRTC signaling between that streamer and the
 *   watchers who chose to watch it, plus binary media for the TCP fallback.
 *
 * Media never passes through here on the WebRTC path; each streamer sends
 * directly to each of its watchers.
 */
export class RoomServer extends EventEmitter<RoomServerEvents> {
  private httpServer: http.Server | https.Server | null = null
  private wss: WebSocketServer | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private readonly seats = new Map<string, Seat>()
  private readonly byWs = new Map<WebSocket, Seat>()
  private readonly alive = new WeakSet<WebSocket>()
  private readonly banned = new Set<string>()
  private readonly history: ChatMessage[] = []
  private readonly pinGuard: PinGuard
  private readonly log: Logger
  private readonly startedAt = Date.now()
  private name: string
  private privacy: Privacy
  private pin: string | null
  private chatMuted = false
  private boundPort = 0
  private ended = false
  private tcpFeedbackTimer: NodeJS.Timeout | null = null

  constructor(private readonly opts: RoomServerOptions) {
    super()
    this.name = opts.name.slice(0, ROOM_NAME_MAX_LENGTH)
    this.privacy = opts.privacy
    this.pin = opts.pin
    this.log = opts.logger ?? noopLogger
    this.pinGuard = opts.pinGuard ?? new PinGuard()
    if (this.privacy === 'private' && !this.pin) throw new Error('private room requires a PIN')
  }

  get port(): number {
    return this.boundPort
  }

  get tls(): boolean {
    return !!this.opts.tls
  }

  async start(): Promise<number> {
    const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => this.handleHttp(req, res)
    const server = this.opts.tls
      ? https.createServer({ key: this.opts.tls.key, cert: this.opts.tls.cert }, handler)
      : http.createServer(handler)
    this.httpServer = server

    const first = this.opts.port
    const candidates = first === 0 ? [0] : [...Array(PORT_SEARCH_RANGE).keys()].map((i) => first + i).concat(0)
    let lastError: unknown
    for (const port of candidates) {
      try {
        await listen(server, port, this.opts.bindAddress ?? '0.0.0.0')
        lastError = null
        break
      } catch (err) {
        lastError = err
      }
    }
    if (lastError) throw lastError
    this.boundPort = (server.address() as AddressInfo).port

    this.wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_PAYLOAD_BYTES, perMessageDeflate: false })
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req))
    this.heartbeat = setInterval(() => this.checkHeartbeat(), HEARTBEAT_INTERVAL_MS)
    this.tcpFeedbackTimer = setInterval(() => this.flushTcpFeedback(), 2000)
    this.log.info(`room server listening on ${this.boundPort} (tls=${this.tls})`)
    return this.boundPort
  }

  async stop(reason = 'The host ended the room'): Promise<void> {
    if (this.ended) return
    this.ended = true
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.tcpFeedbackTimer) clearInterval(this.tcpFeedbackTimer)
    for (const seat of this.seats.values()) {
      if (seat.graceTimer) clearTimeout(seat.graceTimer)
      if (seat.ws) {
        this.send(seat.ws, { type: 'room-ended', reason })
        seat.ws.close(1000, 'room ended')
      }
    }
    this.seats.clear()
    this.byWs.clear()
    // Give the 'room-ended' frames a moment to flush before tearing sockets down.
    await new Promise((resolve) => setTimeout(resolve, 250))
    for (const client of this.wss?.clients ?? []) client.terminate()
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()))
    await new Promise<void>((resolve) => {
      if (!this.httpServer) return resolve()
      this.httpServer.close(() => resolve())
      ;(this.httpServer as http.Server).closeAllConnections?.()
    })
    this.emit('ended', reason)
  }

  getInfo(): RoomInfo {
    return {
      id: this.opts.roomId,
      name: this.name,
      hostName: this.opts.hostName,
      privacy: this.privacy,
      viewerCount: this.viewerSeats().length,
      maxUsers: this.opts.maxUsers ?? MAX_USERS,
      streams: [...this.seats.values()].filter((s) => s.participant.stream).length,
      protocol: PROTOCOL_VERSION,
      startedAt: this.startedAt
    }
  }

  getState(): RoomState {
    return { ...this.getInfo(), chatMuted: this.chatMuted, allowRecording: false }
  }

  /** Change privacy and/or PIN. Existing participants stay connected. */
  update(opts: { name?: string; privacy?: Privacy; pin?: string | null }): void {
    if (opts.name !== undefined) this.name = opts.name.slice(0, ROOM_NAME_MAX_LENGTH) || this.name
    if (opts.pin !== undefined) this.pin = opts.pin
    if (opts.privacy !== undefined) this.privacy = opts.privacy
    if (this.privacy === 'private' && !this.pin) throw new Error('private room requires a PIN')
    this.broadcastRoom()
  }

  // ---------------------------------------------------------------------------

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === 'GET' && req.url?.split('?')[0] === '/info') {
      const body = JSON.stringify(this.getInfo())
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(body)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const ip = normalizeIp(req.socket.remoteAddress)
    this.alive.add(ws)
    ws.on('pong', () => this.alive.add(ws))
    const helloTimer = setTimeout(() => {
      if (!this.byWs.has(ws)) ws.close(4000, 'hello timeout')
    }, HELLO_TIMEOUT_MS)

    ws.on('message', (data: RawData, isBinary: boolean) => {
      const seat = this.byWs.get(ws)
      if (isBinary) {
        if (seat?.participant.stream) this.relayMedia(seat, toBuffer(data))
        return
      }
      let msg: ClientMessage
      try {
        msg = JSON.parse(data.toString()) as ClientMessage
      } catch {
        this.fail(ws, 'bad_request', 'Malformed message', true)
        return
      }
      if (!msg || typeof msg.type !== 'string') return
      if (!seat) {
        if (msg.type === 'hello') {
          clearTimeout(helloTimer)
          this.handleHello(ws, ip, msg)
        } else {
          this.fail(ws, 'bad_request', 'Expected hello', true)
        }
        return
      }
      try {
        this.handleMessage(seat, msg)
      } catch (err) {
        this.log.warn('error handling message', msg.type, err)
      }
    })

    ws.on('close', () => {
      clearTimeout(helloTimer)
      this.handleDisconnect(ws)
    })
    ws.on('error', (err) => this.log.debug('ws error', err.message))
  }

  private handleHello(ws: WebSocket, ip: string, msg: Extract<ClientMessage, { type: 'hello' }>): void {
    if (this.ended) return this.fail(ws, 'bad_request', 'Room has ended', true)
    if (msg.protocol !== PROTOCOL_VERSION) {
      return this.fail(ws, 'version_mismatch', 'This room runs a different app version', true)
    }
    const clientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 64) : ''
    if (!clientId) return this.fail(ws, 'bad_request', 'Missing client id', true)
    const name = sanitizeName(msg.name)
    const decoders = Array.isArray(msg.decoders) ? msg.decoders.slice(0, 16) : []

    // Host (the local renderer) authenticates with a secret token.
    if (typeof msg.hostToken === 'string') {
      if (!pinsEqual(this.opts.hostToken, msg.hostToken)) {
        return this.fail(ws, 'host_only', 'Invalid host token', true)
      }
      const existing = this.seats.get(HOST_ID)
      if (existing?.ws && existing.ws !== ws) {
        this.byWs.delete(existing.ws)
        existing.ws.close(4001, 'replaced')
      }
      const seat: Seat = existing ?? this.newSeat(HOST_ID, clientId, name, 'host', ip, decoders)
      seat.participant.name = name
      seat.decoders = decoders
      this.attach(seat, ws)
      this.welcome(seat)
      this.broadcastParticipants()
      return
    }

    if (this.banned.has(clientId)) return this.fail(ws, 'kicked', 'You were removed from this room', true)

    // Resume a seat that is inside its reconnect grace window.
    const resumable = [...this.seats.values()].find(
      (s) => s.clientId === clientId && s.participant.role === 'viewer'
    )
    if (resumable && typeof msg.resumeToken === 'string' && pinsEqual(resumable.resumeToken, msg.resumeToken)) {
      if (resumable.ws && resumable.ws !== ws) {
        this.byWs.delete(resumable.ws)
        resumable.ws.close(4001, 'replaced')
      }
      resumable.decoders = decoders
      resumable.participant.name = name
      this.attach(resumable, ws)
      this.welcome(resumable)
      this.broadcastParticipants()
      this.log.info(`viewer resumed: ${name}`)
      return
    }

    if (this.privacy === 'private') {
      if (!msg.pin) return this.fail(ws, 'pin_required', 'This room requires a PIN', true)
      const result = this.pinGuard.check(ip, this.pin!, msg.pin)
      if (!result.ok) {
        this.log.warn(`bad PIN from ${ip} (locked=${result.locked})`)
        if (result.locked) {
          return this.fail(ws, 'locked', 'Too many wrong PINs. Try again later.', true, {
            retryAfterMs: result.retryAfterMs
          })
        }
        return this.fail(ws, 'bad_pin', 'Wrong PIN', true, { attemptsLeft: result.attemptsLeft })
      }
    }

    // A fresh join from a client that still holds a stale seat replaces it.
    if (resumable) this.removeSeat(resumable, false)

    const capacity = this.opts.maxUsers ?? MAX_USERS
    if (this.seats.size >= capacity) return this.fail(ws, 'room_full', 'Room is full', true)

    const seat = this.newSeat(randomId(), clientId, name, 'viewer', ip, decoders)
    this.attach(seat, ws)
    this.welcome(seat)
    this.systemMessage(`${name} joined`)
    this.broadcastParticipants()
    this.broadcastRoom()
    this.log.info(`viewer joined: ${name} from ${ip}`)
  }

  private handleMessage(seat: Seat, msg: ClientMessage): void {
    const me = seat.participant
    switch (msg.type) {
      case 'ping':
        this.send(seat.ws, { type: 'pong', t: msg.t, serverTime: Date.now() })
        return
      case 'chat':
        return this.handleChat(seat, msg.text)
      case 'bye':
        this.removeSeat(seat, true)
        seat.ws?.close(1000, 'bye')
        return

      // --- streaming -------------------------------------------------------------
      case 'stream-state':
        return this.handleStreamState(seat, msg)
      case 'publisher-stats':
        for (const sub of seat.watchers.values()) {
          this.send(sub.watcher.ws, { type: 'publisher-stats', from: me.id, encodeMs: msg.encodeMs })
        }
        return
      case 'snapshot': {
        if (!me.stream || !isSnapshot(msg.image)) return
        const now = Date.now()
        if (now - seat.lastSnapshotAt < SNAPSHOT_MIN_INTERVAL_MS) return
        seat.lastSnapshotAt = now
        seat.snapshot = msg.image
        this.broadcast({ type: 'snapshot', from: me.id, image: msg.image }, seat)
        return
      }
      case 'watch': {
        const streamer = this.seats.get(msg.streamer)
        if (!streamer || streamer === seat) {
          return this.fail(seat.ws!, 'bad_request', 'No such participant', false)
        }
        if (!streamer.participant.stream) {
          return this.fail(seat.ws!, 'not_sharing', `${streamer.participant.name} is not sharing`, false)
        }
        const transport: Transport = msg.transport === 'tcp' ? 'tcp' : 'webrtc'
        // Re-watching (e.g. switching transport) replaces the subscription.
        streamer.watchers.set(me.id, {
          watcher: seat,
          transport,
          mediaState: 'negotiating',
          waitingKey: true,
          lastKeyRequest: 0
        })
        this.send(streamer.ws, { type: 'watch-request', from: me.id, transport, decoders: seat.decoders })
        this.broadcastParticipants()
        return
      }
      case 'unwatch': {
        const streamer = this.seats.get(msg.streamer)
        if (streamer?.watchers.delete(me.id)) {
          this.send(streamer.ws, { type: 'watcher-left', id: me.id })
          this.broadcastParticipants()
        }
        return
      }
      case 'signal': {
        // Only a streamer and one of its watchers may exchange signaling, and
        // only for that streamer's connection.
        const target = this.seats.get(msg.to)
        if (!target || target === seat) return
        const fromStreamer = msg.stream === me.id && seat.watchers.has(target.participant.id)
        const fromWatcher = msg.stream === target.participant.id && target.watchers.has(me.id)
        if (!fromStreamer && !fromWatcher) return
        this.send(target.ws, { type: 'signal', from: me.id, stream: msg.stream, data: msg.data })
        return
      }
      case 'stats': {
        const streamer = this.seats.get(msg.streamer)
        const sub = streamer?.watchers.get(me.id)
        if (!streamer || !sub) return
        sub.mediaState = msg.mediaState
        this.send(streamer.ws, { type: 'watcher-stats', from: me.id, stats: msg.stats, mediaState: msg.mediaState })
        return
      }
      case 'view-size': {
        const streamer = this.seats.get(msg.streamer)
        if (!streamer?.watchers.has(me.id)) return
        const height = msg.height === null ? null : Number(msg.height)
        if (height !== null && !(Number.isInteger(height) && height >= 90 && height <= 8640)) return
        this.send(streamer.ws, { type: 'watcher-view', from: me.id, height })
        return
      }
      case 'keyframe-request': {
        const streamer = this.seats.get(msg.streamer)
        const sub = streamer?.watchers.get(me.id)
        if (streamer && sub) this.requestKeyframe(streamer, sub)
        return
      }
    }

    if (me.role !== 'host') {
      this.send(seat.ws, { type: 'error', code: 'host_only', message: 'Only the host can do that', fatal: false })
      return
    }

    switch (msg.type) {
      case 'kick': {
        const target = this.seats.get(msg.userId)
        if (!target || target.participant.role === 'host') return
        this.banned.add(target.clientId)
        this.send(target.ws, { type: 'kicked' })
        target.ws?.close(4003, 'kicked')
        this.removeSeat(target, false)
        this.systemMessage(`${target.participant.name} was removed by the host`)
        this.log.info(`kicked ${target.participant.name}`)
        return
      }
      case 'stop-stream': {
        const target = this.seats.get(msg.userId)
        if (!target?.participant.stream) return
        if (target !== seat) this.send(target.ws, { type: 'stream-stopped', reason: 'The host stopped your stream' })
        this.endStream(target, `The host stopped ${target.participant.name}'s stream`)
        return
      }
      case 'delete-message': {
        const idx = this.history.findIndex((m) => m.id === msg.id)
        if (idx >= 0) this.history.splice(idx, 1)
        this.broadcast({ type: 'chat-deleted', id: msg.id })
        return
      }
      case 'mute-chat':
        if (this.chatMuted === !!msg.muted) return
        this.chatMuted = !!msg.muted
        this.systemMessage(this.chatMuted ? 'The host muted the chat' : 'The host unmuted the chat')
        this.broadcastRoom()
        return
      case 'end-room':
        void this.stop('The host ended the room')
        return
    }
  }

  private handleStreamState(seat: Seat, msg: Extract<ClientMessage, { type: 'stream-state' }>): void {
    const p = seat.participant
    if (!msg.sharing) {
      this.endStream(seat, `${p.name} stopped sharing`)
      return
    }
    const paused = !!msg.paused
    const audio = !!msg.audio && !paused
    if (!p.stream) {
      p.stream = { paused, audio, startedAt: Date.now() }
      this.systemMessage(`${p.name} started sharing their screen`)
      this.broadcastParticipants()
      this.broadcastRoom()
      return
    }
    if (p.stream.paused === paused && p.stream.audio === audio) return
    p.stream = { ...p.stream, paused, audio }
    this.broadcastParticipants()
  }

  /** End a seat's stream: its watchers are told and all subscriptions dropped. */
  private endStream(seat: Seat, announcement: string | null): void {
    if (!seat.participant.stream) return
    seat.participant.stream = null
    for (const sub of seat.watchers.values()) {
      this.send(sub.watcher.ws, { type: 'stream-ended', streamer: seat.participant.id })
    }
    seat.watchers.clear()
    seat.tcpStats = { sent: 0, dropped: 0 }
    if (seat.snapshot) {
      seat.snapshot = null
      this.broadcast({ type: 'snapshot', from: seat.participant.id, image: null }, seat)
    }
    if (announcement) this.systemMessage(announcement)
    this.broadcastParticipants()
    this.broadcastRoom()
  }

  /** Remove every subscription a seat holds as a watcher. */
  private dropWatcher(seat: Seat): boolean {
    let changed = false
    for (const streamer of this.seats.values()) {
      if (streamer.watchers.delete(seat.participant.id)) {
        this.send(streamer.ws, { type: 'watcher-left', id: seat.participant.id })
        changed = true
      }
    }
    return changed
  }

  private handleChat(seat: Seat, raw: unknown): void {
    if (typeof raw !== 'string') return
    const text = raw.trim()
    if (!text) return
    if (text.length > CHAT_MAX_LENGTH) {
      this.send(seat.ws, { type: 'error', code: 'bad_request', message: 'Message too long', fatal: false })
      return
    }
    if (this.chatMuted && seat.participant.role !== 'host') {
      this.send(seat.ws, { type: 'error', code: 'chat_muted', message: 'The host has muted the chat', fatal: false })
      return
    }
    const now = Date.now()
    seat.chatTimes = seat.chatTimes.filter((t) => now - t < 1000)
    if (seat.chatTimes.length >= CHAT_RATE_LIMIT) {
      this.send(seat.ws, { type: 'error', code: 'rate_limited', message: 'Slow down', fatal: false })
      return
    }
    seat.chatTimes.push(now)
    const p = seat.participant
    this.pushChat({ id: randomId(), userId: p.id, name: p.name, color: p.color, text, ts: now })
  }

  private systemMessage(text: string): void {
    this.pushChat({ id: randomId(), userId: 'system', name: 'System', color: '#888888', text, ts: Date.now(), system: true })
  }

  private pushChat(message: ChatMessage): void {
    this.history.push(message)
    if (this.history.length > CHAT_HISTORY_LIMIT) this.history.splice(0, this.history.length - CHAT_HISTORY_LIMIT)
    this.broadcast({ type: 'chat', message })
  }

  /**
   * Forward a streamer's media packet to its TCP-fallback watchers, prefixed
   * with the streamer's slot so receivers know whose stream it is. Per-watcher
   * backpressure: video resumes only on a keyframe after drops; audio packets
   * are independently decodable, so they bypass (and never reset) that gate.
   */
  private relayMedia(streamer: Seat, packet: Buffer): void {
    if (packet.length < 2) return
    const kind = packet[0]
    if (kind !== BINARY_KIND_VIDEO && kind !== BINARY_KIND_AUDIO) return
    const isKey = (packet[1] & BINARY_FLAG_KEY) !== 0
    let tagged: Buffer | null = null
    for (const sub of streamer.watchers.values()) {
      const ws = sub.watcher.ws
      if (sub.transport !== 'tcp' || !ws || ws.readyState !== WebSocket.OPEN) continue
      tagged ??= Buffer.concat([Buffer.from([streamer.participant.slot]), packet])
      if (kind === BINARY_KIND_AUDIO) {
        if (ws.bufferedAmount <= TCP_MAX_BUFFERED_BYTES) ws.send(tagged, { binary: true })
        continue
      }
      if (sub.waitingKey && !isKey) {
        streamer.tcpStats.dropped++
        continue
      }
      if (ws.bufferedAmount > TCP_MAX_BUFFERED_BYTES) {
        // Watcher can't keep up: skip until the next keyframe so decoding stays valid.
        sub.waitingKey = true
        streamer.tcpStats.dropped++
        this.requestKeyframe(streamer, sub)
        continue
      }
      sub.waitingKey = false
      streamer.tcpStats.sent++
      ws.send(tagged, { binary: true })
    }
  }

  private requestKeyframe(streamer: Seat, sub: Subscription): void {
    const now = Date.now()
    if (now - sub.lastKeyRequest < 1000) return
    sub.lastKeyRequest = now
    this.send(streamer.ws, { type: 'keyframe-request', from: sub.watcher.participant.id })
  }

  private flushTcpFeedback(): void {
    for (const seat of this.seats.values()) {
      const { sent, dropped } = seat.tcpStats
      if (sent === 0 && dropped === 0) continue
      this.send(seat.ws, { type: 'tcp-feedback', sent, dropped })
      seat.tcpStats = { sent: 0, dropped: 0 }
    }
  }

  private handleDisconnect(ws: WebSocket): void {
    const seat = this.byWs.get(ws)
    this.byWs.delete(ws)
    if (!seat || seat.ws !== ws) return
    seat.ws = null
    if (this.ended) return
    seat.participant.status = 'reconnecting'
    // Without signaling a stream can't be renegotiated: end it (the client
    // re-announces after reconnecting) and drop what this seat was watching.
    this.endStream(seat, null)
    this.dropWatcher(seat)
    if (seat.participant.role === 'viewer') {
      seat.graceTimer = setTimeout(() => {
        this.removeSeat(seat, true)
      }, RESUME_GRACE_MS)
    }
    this.broadcastParticipants()
  }

  private removeSeat(seat: Seat, announce: boolean): void {
    if (this.seats.get(seat.participant.id) !== seat) return
    if (seat.graceTimer) clearTimeout(seat.graceTimer)
    this.endStream(seat, null)
    this.seats.delete(seat.participant.id)
    if (seat.ws) this.byWs.delete(seat.ws)
    this.dropWatcher(seat)
    if (announce) this.systemMessage(`${seat.participant.name} left`)
    this.broadcastParticipants()
    this.broadcastRoom()
  }

  private newSeat(
    id: string,
    clientId: string,
    name: string,
    role: Participant['role'],
    ip: string,
    decoders: CodecSupport[]
  ): Seat {
    const seat: Seat = {
      participant: {
        id,
        name,
        role,
        color: colorFor(clientId),
        joinedAt: Date.now(),
        status: 'connected',
        slot: this.freeSlot(),
        stream: null,
        watching: []
      },
      clientId,
      ws: null,
      ip,
      resumeToken: randomToken(),
      graceTimer: null,
      decoders,
      chatTimes: [],
      watchers: new Map(),
      tcpStats: { sent: 0, dropped: 0 },
      snapshot: null,
      lastSnapshotAt: 0
    }
    this.seats.set(id, seat)
    return seat
  }

  /** Lowest slot not used by a current seat (seats are capped well below 256). */
  private freeSlot(): number {
    const used = new Set([...this.seats.values()].map((s) => s.participant.slot))
    for (let slot = 0; slot < MAX_SLOTS; slot++) if (!used.has(slot)) return slot
    throw new Error('no free participant slot')
  }

  private attach(seat: Seat, ws: WebSocket): void {
    if (seat.graceTimer) clearTimeout(seat.graceTimer)
    seat.graceTimer = null
    seat.ws = ws
    seat.participant.status = 'connected'
    this.byWs.set(ws, seat)
  }

  private welcome(seat: Seat): void {
    this.send(seat.ws, {
      type: 'welcome',
      selfId: seat.participant.id,
      resumeToken: seat.resumeToken,
      room: this.getState(),
      participants: this.participantList(),
      history: this.history
    })
    // Late joiners get the current previews of everyone sharing.
    for (const other of this.seats.values()) {
      if (other !== seat && other.snapshot) {
        this.send(seat.ws, { type: 'snapshot', from: other.participant.id, image: other.snapshot })
      }
    }
  }

  private fail(
    ws: WebSocket,
    code: ErrorCode,
    message: string,
    fatal: boolean,
    extra: { retryAfterMs?: number; attemptsLeft?: number } = {}
  ): void {
    this.send(ws, { type: 'error', code, message, fatal, ...extra })
    if (fatal) ws.close(4002, code)
  }

  private checkHeartbeat(): void {
    for (const ws of this.wss?.clients ?? []) {
      if (!this.alive.has(ws)) {
        ws.terminate()
        continue
      }
      this.alive.delete(ws)
      ws.ping()
    }
  }

  private viewerSeats(): Seat[] {
    return [...this.seats.values()].filter((s) => s.participant.role === 'viewer')
  }

  private participantList(): Participant[] {
    const watching = new Map<string, string[]>()
    for (const streamer of this.seats.values()) {
      for (const watcherId of streamer.watchers.keys()) {
        const list = watching.get(watcherId) ?? []
        list.push(streamer.participant.id)
        watching.set(watcherId, list)
      }
    }
    return [...this.seats.values()].map((s) => ({
      ...s.participant,
      stream: s.participant.stream ? { ...s.participant.stream } : null,
      watching: watching.get(s.participant.id) ?? []
    }))
  }

  private broadcastParticipants(): void {
    this.broadcast({ type: 'participants', participants: this.participantList() })
  }

  private broadcastRoom(): void {
    this.broadcast({ type: 'room', room: this.getState() })
    this.emit('change', this.getInfo())
  }

  private broadcast(msg: ServerMessage, except?: Seat): void {
    const data = JSON.stringify(msg)
    for (const seat of this.seats.values()) {
      if (seat !== except && seat.ws?.readyState === WebSocket.OPEN) seat.ws.send(data)
    }
  }

  private send(ws: WebSocket | null, msg: ServerMessage): void {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }
}

function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function normalizeIp(ip: string | undefined): string {
  if (!ip) return 'unknown'
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}

function sanitizeName(name: unknown): string {
  const clean = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX_LENGTH) : ''
  return clean || 'Guest'
}

function colorFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return COLORS[Math.abs(h) % COLORS.length]
}

const SNAPSHOT_PATTERN = /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

function isSnapshot(image: unknown): image is string {
  return typeof image === 'string' && image.length <= SNAPSHOT_MAX_CHARS && SNAPSHOT_PATTERN.test(image)
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data as ArrayBuffer)
}
