import { STATS_INTERVAL_MS, WEBRTC_CONNECT_TIMEOUT_MS } from '../../shared/constants'
import type { MediaState, RoomState, ServerMessage, Transport, ViewerStats } from '../../shared/types'
import { shortCodecName } from './codecs'
import { Emitter } from './emitter'
import type { RoomClient } from './roomClient'
import { TcpDecoder } from './tcpStream'

type Events = {
  stream: MediaStream | null
  state: MediaState
  stats: ViewerStats
}

const log = (msg: string): void => {
  console.info(`[viewer] ${msg}`)
  window.api.system.log('info', `[viewer] ${msg}`)
}

const EMPTY_STATS: ViewerStats = {
  fps: 0,
  latencyMs: null,
  bitrateKbps: 0,
  packetLossPct: 0,
  width: 0,
  height: 0,
  codec: '',
  transport: null,
  decoder: '',
  framesDropped: 0
}

/**
 * Viewer side of the stream. Asks the host for a WebRTC stream and falls back
 * to the TCP (WebSocket + WebCodecs) transport when ICE can't connect in time
 * or the connection fails. Re-requests the stream after reconnects and when
 * the host (re)starts sharing.
 */
export class ViewerReceiver extends Emitter<Events> {
  stream: MediaStream | null = null
  state: MediaState = 'idle'
  stats: ViewerStats = EMPTY_STATS
  transport: Transport

  private pc: RTCPeerConnection | null = null
  private tcp: TcpDecoder | null = null
  private pendingCandidates: RTCIceCandidateInit[] = []
  private connectTimer: number | null = null
  private readonly statsTimer: number
  private readonly unsubscribers: (() => void)[] = []
  private prev: { ts: number; bytes: number; lost: number; received: number; jbDelay: number; jbCount: number; decodeTime: number; decoded: number } | null = null
  private hostEncodeMs: number | null = null
  private tick = 0
  private wasSharing = false

  constructor(
    private readonly client: RoomClient,
    forceTcp: boolean
  ) {
    super()
    this.transport = forceTcp ? 'tcp' : 'webrtc'
    this.unsubscribers.push(
      client.on('welcome', () => this.requestStream()),
      client.on('room', (room) => this.onRoom(room)),
      client.on('message', (msg) => void this.onMessage(msg)),
      client.on('binary', (buf) => this.tcp?.push(buf))
    )
    this.statsTimer = window.setInterval(() => void this.collectStats(), STATS_INTERVAL_MS)
    if (client.state === 'connected') this.requestStream()
  }

  /** Try WebRTC again (e.g. after a TCP fallback) or re-request the stream. */
  retry(transport: Transport = 'webrtc'): void {
    this.transport = transport
    this.requestStream()
  }

  dispose(): void {
    this.teardown()
    this.unsubscribers.forEach((u) => u())
    clearInterval(this.statsTimer)
    this.removeAllListeners()
  }

  private onRoom(room: RoomState): void {
    if (!room.sharing) {
      this.wasSharing = false
      if (this.state !== 'idle') {
        this.teardown()
        this.setState('idle')
      }
      return
    }
    if (!this.wasSharing && this.state === 'idle') this.requestStream()
    this.wasSharing = true
  }

  private requestStream(): void {
    this.wasSharing = !!this.client.room?.sharing
    if (!this.client.room?.sharing) {
      this.teardown()
      this.setState('idle')
      return
    }
    this.teardown()
    this.setState('negotiating')
    if (this.transport === 'tcp') {
      this.tcp = new TcpDecoder(
        () => this.client.clockOffsetMs,
        () => this.client.send({ type: 'keyframe-request' }),
        log
      )
      this.setStream(this.tcp.stream)
      this.client.send({ type: 'request-stream', transport: 'tcp' })
      log('requested TCP stream')
      return
    }
    this.client.send({ type: 'request-stream', transport: 'webrtc' })
    this.connectTimer = window.setTimeout(() => this.fallbackToTcp('WebRTC connect timeout'), WEBRTC_CONNECT_TIMEOUT_MS)
    log('requested WebRTC stream')
  }

  private fallbackToTcp(reason: string): void {
    if (this.transport === 'tcp') return
    log(`falling back to TCP: ${reason}`)
    this.transport = 'tcp'
    this.requestStream()
  }

  private async onMessage(msg: ServerMessage): Promise<void> {
    if (msg.type === 'host-stats') {
      this.hostEncodeMs = msg.encodeMs
      return
    }
    if (msg.type !== 'signal' || msg.from !== 'host') return
    const data = msg.data
    if (data.kind === 'offer') {
      if (this.transport !== 'webrtc') return
      await this.handleOffer(data.sdp)
    } else if (data.kind === 'candidate' && data.candidate && this.pc) {
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(data.candidate).catch(() => {})
      else this.pendingCandidates.push(data.candidate)
    }
  }

  private async handleOffer(sdp: string): Promise<void> {
    this.closePeer()
    const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' })
    this.pc = pc
    pc.ontrack = (e) => {
      // Render frames as soon as they are decoded: this is a live screen, not a movie.
      const receiver = e.receiver as RTCRtpReceiver & { jitterBufferTarget?: number; playoutDelayHint?: number }
      try {
        receiver.jitterBufferTarget = 0
      } catch {
        // unsupported
      }
      this.setStream(e.streams[0] ?? new MediaStream([e.track]))
    }
    pc.onicecandidate = (e) => {
      this.client.send({ type: 'signal', to: 'host', data: { kind: 'candidate', candidate: e.candidate?.toJSON() ?? null } })
    }
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return
      log(`connection ${pc.connectionState}`)
      if (pc.connectionState === 'connected') {
        if (this.connectTimer) clearTimeout(this.connectTimer)
        this.connectTimer = null
        this.setState('streaming')
      } else if (pc.connectionState === 'failed') {
        this.fallbackToTcp('ICE failed')
      }
    }
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp })
      for (const c of this.pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => {})
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      this.client.send({ type: 'signal', to: 'host', data: { kind: 'answer', sdp: pc.localDescription!.sdp } })
    } catch (err) {
      log(`negotiation failed: ${String(err)}`)
      this.fallbackToTcp('negotiation failed')
    }
  }

  private teardown(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.connectTimer = null
    this.closePeer()
    this.tcp?.close()
    this.tcp = null
    this.prev = null
    this.setStream(null)
  }

  private closePeer(): void {
    this.pendingCandidates = []
    if (!this.pc) return
    this.pc.ontrack = null
    this.pc.onicecandidate = null
    this.pc.onconnectionstatechange = null
    this.pc.close()
    this.pc = null
  }

  private setStream(stream: MediaStream | null): void {
    if (this.stream === stream) return
    this.stream = stream
    this.emit('stream', stream)
  }

  private setState(state: MediaState): void {
    if (this.state === state) return
    this.state = state
    this.emit('state', state)
  }

  private async collectStats(): Promise<void> {
    this.tick++
    const stats = this.tcp ? this.tcpStats() : await this.webrtcStats()
    if (!stats) return
    this.stats = stats
    this.emit('stats', stats)
    if (this.tick % 2 === 0) this.client.send({ type: 'stats', stats, mediaState: this.state })
  }

  private tcpStats(): ViewerStats | null {
    const tcp = this.tcp!
    const now = performance.now()
    const s = tcp.stats
    const prev = this.prev
    this.prev = { ts: now, bytes: s.bytes, lost: s.framesDropped, received: s.framesDecoded, jbDelay: 0, jbCount: 0, decodeTime: 0, decoded: 0 }
    if (s.framesDecoded > 0 && this.state === 'negotiating') this.setState('streaming')
    if (!prev) return null
    const dt = (now - prev.ts) / 1000
    const frames = s.framesDecoded - prev.received
    const dropped = s.framesDropped - prev.lost
    return {
      fps: dt > 0 ? Math.round(frames / dt) : 0,
      latencyMs: s.latencyMs === null ? null : Math.round(s.latencyMs),
      bitrateKbps: dt > 0 ? Math.round(((s.bytes - prev.bytes) * 8) / 1000 / dt) : 0,
      packetLossPct: frames + dropped > 0 ? (dropped / (frames + dropped)) * 100 : 0,
      width: s.width,
      height: s.height,
      codec: s.codec.split('.')[0].toUpperCase(),
      transport: 'tcp',
      decoder: 'WebCodecs',
      framesDropped: s.framesDropped
    }
  }

  private async webrtcStats(): Promise<ViewerStats | null> {
    if (!this.pc) return this.state === 'idle' ? { ...EMPTY_STATS } : null
    let report: RTCStatsReport
    try {
      report = await this.pc.getStats()
    } catch {
      return null
    }
    let inb: Record<string, any> | undefined
    let pair: Record<string, any> | undefined
    const codecs = new Map<string, string>()
    report.forEach((s: Record<string, any>) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') inb = s
      else if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s
      else if (s.type === 'codec') codecs.set(s.id, s.mimeType)
    })
    if (!inb) return null
    const now = performance.now()
    const cur = {
      ts: now,
      bytes: Number(inb.bytesReceived ?? 0),
      lost: Number(inb.packetsLost ?? 0),
      received: Number(inb.packetsReceived ?? 0),
      jbDelay: Number(inb.jitterBufferDelay ?? 0),
      jbCount: Number(inb.jitterBufferEmittedCount ?? 0),
      decodeTime: Number(inb.totalDecodeTime ?? 0),
      decoded: Number(inb.framesDecoded ?? 0)
    }
    const prev = this.prev
    this.prev = cur
    if (!prev) return null
    const dt = (now - prev.ts) / 1000
    const lost = Math.max(0, cur.lost - prev.lost)
    const received = Math.max(0, cur.received - prev.received)
    const jbCount = cur.jbCount - prev.jbCount
    const decoded = cur.decoded - prev.decoded
    const rttMs = typeof pair?.currentRoundTripTime === 'number' ? pair.currentRoundTripTime * 1000 : (this.client.rttMs ?? 0)
    const fps = Number(inb.framesPerSecond ?? 0)

    // Glass-to-glass estimate: capture (~½ frame) + encode + network (½ RTT)
    // + jitter buffer + decode + display (~½ refresh).
    const jitterMs = jbCount > 0 ? ((cur.jbDelay - prev.jbDelay) / jbCount) * 1000 : 0
    const decodeMs = decoded > 0 ? ((cur.decodeTime - prev.decodeTime) / decoded) * 1000 : 0
    const frameMs = fps > 0 ? 1000 / fps : 16.7
    const latency = frameMs / 2 + (this.hostEncodeMs ?? 5) + rttMs / 2 + jitterMs + decodeMs + 8

    return {
      fps: Math.round(fps),
      latencyMs: decoded > 0 ? Math.round(latency) : null,
      bitrateKbps: dt > 0 ? Math.round(((cur.bytes - prev.bytes) * 8) / 1000 / dt) : 0,
      packetLossPct: lost + received > 0 ? (lost / (lost + received)) * 100 : 0,
      width: Number(inb.frameWidth ?? 0),
      height: Number(inb.frameHeight ?? 0),
      codec: shortCodecName(codecs.get(inb.codecId) ?? ''),
      transport: 'webrtc',
      decoder: String(inb.decoderImplementation ?? ''),
      framesDropped: Number(inb.framesDropped ?? 0)
    }
  }
}
