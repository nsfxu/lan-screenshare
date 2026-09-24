import { STATS_INTERVAL_MS } from '../../shared/constants'
import { AdaptiveController, encodingFor, getPreset, qualityLadder } from '../../shared/quality'
import type {
  CodecSupport,
  HostStats,
  ServerMessage,
  Settings,
  Transport,
  ViewerStats
} from '../../shared/types'
import { applyCodecOrder, chooseCodecOrder, mungeBitrates, shortCodecName } from './codecs'
import { Emitter } from './emitter'
import type { RoomClient } from './roomClient'
import { TcpEncoder } from './tcpStream'

interface Peer {
  pc: RTCPeerConnection
  sender: RTCRtpSender
  controller: AdaptiveController
  pendingCandidates: RTCIceCandidateInit[]
  remoteSet: boolean
  prev: { ts: number; bytes: number; encodeTime: number; framesEncoded: number } | null
  sample: PeerSample | null
}

interface PeerSample {
  bitrateKbps: number
  fps: number
  rttMs: number | null
  lossPct: number
  encodeMs: number | null
  encoder: string
  codec: string
  limitation: string
  width: number
  height: number
}

type Events = {
  stream: MediaStream | null
  sharing: { sharing: boolean; paused: boolean }
  stats: HostStats
  viewerStats: Map<string, ViewerStats>
  error: string
}

const log = (msg: string): void => {
  console.info(`[host] ${msg}`)
  window.api.system.log('info', `[host] ${msg}`)
}

/**
 * Host side of the stream: captures the chosen screen/window once and fans it
 * out to each viewer with its own RTCPeerConnection (so every viewer gets its
 * own congestion control and adaptive quality), plus one shared WebCodecs
 * encoder for viewers on the TCP fallback.
 */
export class HostStreamer extends Emitter<Events> {
  stream: MediaStream | null = null
  paused = false
  sourceId: string | null = null
  readonly viewerStats = new Map<string, ViewerStats>()
  lastStats: HostStats | null = null

  private track: MediaStreamTrack | null = null
  private readonly peers = new Map<string, Peer>()
  private readonly tcpViewers = new Set<string>()
  private tcp: TcpEncoder | null = null
  private tcpPrev: { ts: number; bytes: number } | null = null
  private readonly statsTimer: number
  private readonly unsubscribe: () => void
  private tick = 0
  private disposed = false

  constructor(
    private readonly client: RoomClient,
    private settings: Settings,
    private readonly encoders: CodecSupport[]
  ) {
    super()
    this.unsubscribe = client.on('message', (m) => void this.onMessage(m))
    this.statsTimer = window.setInterval(() => void this.collectStats(), STATS_INTERVAL_MS)
  }

  get sharing(): boolean {
    return !!this.track
  }

  updateSettings(settings: Settings): void {
    this.settings = settings
    if (this.track) this.track.contentHint = settings.contentHint
  }

  /** Start capturing (or switch to another source without renegotiating). */
  async startCapture(sourceId: string): Promise<void> {
    await window.api.capture.select(sourceId)
    const preset = getPreset(this.settings.maxQuality)
    const video: MediaTrackConstraints = { frameRate: { ideal: preset.fps, max: preset.fps } }
    if (preset.height > 0) video.height = { max: preset.height }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false })
    if (this.disposed) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    const track = stream.getVideoTracks()[0]
    track.contentHint = this.settings.contentHint
    track.addEventListener('ended', () => {
      if (this.track === track) this.stopSharing()
    })
    const settings = track.getSettings()
    log(`capturing ${settings.width}x${settings.height}@${settings.frameRate} from ${sourceId}`)

    const old = this.track
    this.stream = stream
    this.track = track
    this.sourceId = sourceId

    if (old) {
      // Source switch: swap the track on every live connection.
      for (const peer of this.peers.values()) {
        await peer.sender.replaceTrack(this.paused ? null : track).catch(() => {})
        peer.controller.reset(Date.now())
        await this.applyEncoding(peer)
      }
      this.tcp?.replaceTrack(track)
      old.stop()
    }
    this.emit('stream', stream)
    this.publishSharing()
  }

  setPaused(paused: boolean): void {
    if (!this.track || this.paused === paused) return
    this.paused = paused
    for (const peer of this.peers.values()) void peer.sender.replaceTrack(paused ? null : this.track).catch(() => {})
    this.tcp?.setPaused(paused)
    this.publishSharing()
  }

  /** Stop capturing; viewers stay in the room and see "not sharing". */
  stopSharing(): void {
    for (const id of [...this.peers.keys()]) this.closePeer(id)
    this.tcp?.stop()
    this.tcp = null
    this.tcpViewers.clear()
    this.track?.stop()
    this.track = null
    this.stream = null
    this.paused = false
    this.sourceId = null
    this.emit('stream', null)
    this.publishSharing()
  }

  dispose(): void {
    this.disposed = true
    this.stopSharing()
    this.unsubscribe()
    clearInterval(this.statsTimer)
    this.removeAllListeners()
  }

  private publishSharing(): void {
    const state = { sharing: !!this.track, paused: this.paused }
    this.client.send({ type: 'sharing', ...state })
    this.emit('sharing', state)
  }

  private async onMessage(msg: ServerMessage): Promise<void> {
    switch (msg.type) {
      case 'welcome':
        // Reconnected to our own server: re-announce state.
        if (this.track) this.publishSharing()
        return
      case 'request-stream':
        if (!this.track) return // the viewer asks again once we start sharing
        return this.connect(msg.from, msg.transport, msg.decoders)
      case 'signal': {
        const peer = this.peers.get(msg.from)
        if (!peer) return
        if (msg.data.kind === 'answer') {
          const preset = peer.controller.preset
          const sdp = mungeBitrates(msg.data.sdp, Math.min(preset.maxBitrate * 0.6, 8_000_000) / 1000, 300)
          try {
            await peer.pc.setRemoteDescription({ type: 'answer', sdp })
            peer.remoteSet = true
            for (const c of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {})
          } catch (err) {
            log(`setRemoteDescription failed for ${msg.from}: ${String(err)}`)
            this.closePeer(msg.from)
          }
        } else if (msg.data.kind === 'candidate' && msg.data.candidate) {
          if (peer.remoteSet) await peer.pc.addIceCandidate(msg.data.candidate).catch(() => {})
          else peer.pendingCandidates.push(msg.data.candidate)
        }
        return
      }
      case 'viewer-left':
        this.closePeer(msg.id)
        this.removeTcpViewer(msg.id)
        this.viewerStats.delete(msg.id)
        this.emit('viewerStats', this.viewerStats)
        return
      case 'viewer-stats':
        this.viewerStats.set(msg.from, msg.stats)
        this.emit('viewerStats', this.viewerStats)
        return
      case 'keyframe-request':
        this.tcp?.requestKeyframe()
        return
      case 'tcp-feedback':
        this.tcp?.feedback(msg.sent, msg.dropped)
        return
    }
  }

  private async connect(viewerId: string, transport: Transport, decoders: CodecSupport[]): Promise<void> {
    this.closePeer(viewerId)
    if (transport === 'tcp') {
      this.tcpViewers.add(viewerId)
      if (!this.tcp && this.track) {
        this.tcp = new TcpEncoder(this.track, this.client, this.settings.maxQuality, this.settings.adaptiveQuality, log)
        this.tcp.setPaused(this.paused)
      }
      this.tcp?.requestKeyframe()
      log(`viewer ${viewerId} on TCP fallback`)
      return
    }
    this.removeTcpViewer(viewerId)
    if (!this.track || !this.stream) return

    const ladder = qualityLadder(this.settings.maxQuality)
    const controller = new AdaptiveController(this.settings.adaptiveQuality ? ladder : ladder.slice(0, 1), Date.now())
    const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' })
    const enc = encodingFor(controller.preset, this.track.getSettings().height ?? 1080)
    const transceiver = pc.addTransceiver(this.track, {
      direction: 'sendonly',
      streams: [this.stream],
      sendEncodings: [{ ...enc, priority: 'high', networkPriority: 'high' }]
    })
    const order = chooseCodecOrder(this.settings.codec, this.encoders, decoders)
    applyCodecOrder(transceiver, order)
    const peer: Peer = {
      pc,
      sender: transceiver.sender,
      controller,
      pendingCandidates: [],
      remoteSet: false,
      prev: null,
      sample: null
    }
    this.peers.set(viewerId, peer)
    if (this.paused) await peer.sender.replaceTrack(null)

    pc.onicecandidate = (e) => {
      this.client.send({ type: 'signal', to: viewerId, data: { kind: 'candidate', candidate: e.candidate?.toJSON() ?? null } })
    }
    pc.onconnectionstatechange = () => {
      log(`viewer ${viewerId} connection ${pc.connectionState}`)
      if (pc.connectionState === 'failed' && this.peers.get(viewerId)?.pc === pc) this.closePeer(viewerId)
    }

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await this.applyEncoding(peer)
      this.client.send({ type: 'signal', to: viewerId, data: { kind: 'offer', sdp: pc.localDescription!.sdp } })
      log(`offer sent to ${viewerId} (codecs: ${order.map(shortCodecName).join(' > ')})`)
    } catch (err) {
      log(`offer failed for ${viewerId}: ${String(err)}`)
      this.closePeer(viewerId)
    }
  }

  private async applyEncoding(peer: Peer): Promise<void> {
    const params = peer.sender.getParameters()
    if (!params.encodings?.length) return
    const enc = encodingFor(peer.controller.preset, this.track?.getSettings().height ?? 1080)
    params.encodings[0] = { ...params.encodings[0], ...enc }
    // 'motion' content keeps the frame rate and trades resolution; 'detail' keeps text sharp.
    ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
      this.settings.contentHint === 'motion' ? 'maintain-framerate' : 'maintain-resolution'
    try {
      await peer.sender.setParameters(params)
    } catch (err) {
      log(`setParameters failed: ${String(err)}`)
    }
  }

  private closePeer(id: string): void {
    const peer = this.peers.get(id)
    if (!peer) return
    this.peers.delete(id)
    peer.pc.onicecandidate = null
    peer.pc.onconnectionstatechange = null
    peer.pc.close()
  }

  private removeTcpViewer(id: string): void {
    if (!this.tcpViewers.delete(id)) return
    if (this.tcpViewers.size === 0) {
      this.tcp?.stop()
      this.tcp = null
    }
  }

  private async collectStats(): Promise<void> {
    this.tick++
    const now = performance.now()
    await Promise.all([...this.peers.values()].map((p) => this.samplePeer(p, now)))

    for (const peer of this.peers.values()) {
      const s = peer.sample
      if (!s || !this.settings.adaptiveQuality || this.paused) continue
      const limitation = (['none', 'cpu', 'bandwidth'].includes(s.limitation) ? s.limitation : 'other') as
        | 'none'
        | 'cpu'
        | 'bandwidth'
        | 'other'
      const decision = peer.controller.update({ lossPct: s.lossPct, rttMs: s.rttMs, limitation }, Date.now())
      if (decision !== 'hold') {
        log(`quality ${decision} -> ${peer.controller.preset.id} (loss ${s.lossPct.toFixed(1)}%, rtt ${s.rttMs ?? '-'}ms, limit ${s.limitation})`)
        await this.applyEncoding(peer)
      }
    }

    const samples = [...this.peers.values()].map((p) => p.sample).filter((s): s is PeerSample => !!s)
    let tcpKbps = 0
    if (this.tcp) {
      const prev = this.tcpPrev
      if (prev) tcpKbps = ((this.tcp.sentBytes - prev.bytes) * 8) / (now - prev.ts)
      this.tcpPrev = { ts: now, bytes: this.tcp.sentBytes }
    } else this.tcpPrev = null

    const system = await window.api.system.stats().catch(() => ({ cpuPercent: 0, memoryMB: 0 }))
    const trackSettings = this.track?.getSettings()
    const rtts = samples.map((s) => s.rttMs).filter((r): r is number => r !== null)
    const encodes = samples.map((s) => s.encodeMs).filter((e): e is number => e !== null)
    if (this.tcp?.encodeMs != null) encodes.push(this.tcp.encodeMs)
    const worst = samples.find((s) => s.limitation !== 'none')
    const main = samples[0]
    const stats: HostStats = {
      fps: main ? Math.max(...samples.map((s) => s.fps)) : this.paused ? 0 : (trackSettings?.frameRate ?? 0),
      width: main?.width ?? this.tcp?.width ?? trackSettings?.width ?? 0,
      height: main?.height ?? this.tcp?.height ?? trackSettings?.height ?? 0,
      bitrateKbps: Math.round(samples.reduce((sum, s) => sum + s.bitrateKbps, 0) + tcpKbps),
      avgRttMs: rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : null,
      encodeMs: encodes.length ? Math.round((encodes.reduce((a, b) => a + b, 0) / encodes.length) * 10) / 10 : null,
      encoder: main?.encoder || (this.tcp ? `WebCodecs${this.tcp.hardware ? ' (hw)' : ''}` : ''),
      codec: main?.codec || this.tcp?.codecName || '',
      cpuPercent: system.cpuPercent,
      memoryMB: system.memoryMB,
      viewers: this.peers.size + this.tcpViewers.size,
      qualityLimitation: worst?.limitation ?? 'none'
    }
    this.lastStats = stats
    this.emit('stats', stats)
    if (this.tick % 2 === 0) this.client.send({ type: 'host-stats', encodeMs: stats.encodeMs })
  }

  private async samplePeer(peer: Peer, now: number): Promise<void> {
    let report: RTCStatsReport
    try {
      report = await peer.pc.getStats()
    } catch {
      return
    }
    let out: Record<string, any> | undefined
    let remote: Record<string, any> | undefined
    let pair: Record<string, any> | undefined
    const codecs = new Map<string, string>()
    report.forEach((s: Record<string, any>) => {
      if (s.type === 'outbound-rtp' && s.kind === 'video') out = s
      else if (s.type === 'remote-inbound-rtp' && s.kind === 'video') remote = s
      else if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s
      else if (s.type === 'codec') codecs.set(s.id, s.mimeType)
    })
    if (!out) return
    const bytes = Number(out.bytesSent ?? 0)
    const encodeTime = Number(out.totalEncodeTime ?? 0)
    const framesEncoded = Number(out.framesEncoded ?? 0)
    const prev = peer.prev
    peer.prev = { ts: now, bytes, encodeTime, framesEncoded }
    if (!prev) return
    const dt = (now - prev.ts) / 1000
    const frames = framesEncoded - prev.framesEncoded
    const rtt = remote?.roundTripTime ?? pair?.currentRoundTripTime
    peer.sample = {
      bitrateKbps: dt > 0 ? ((bytes - prev.bytes) * 8) / 1000 / dt : 0,
      fps: Number(out.framesPerSecond ?? (dt > 0 ? frames / dt : 0)),
      rttMs: typeof rtt === 'number' ? Math.round(rtt * 1000) : null,
      lossPct: typeof remote?.fractionLost === 'number' ? remote.fractionLost * 100 : 0,
      encodeMs: frames > 0 ? ((encodeTime - prev.encodeTime) / frames) * 1000 : null,
      encoder: String(out.encoderImplementation ?? ''),
      codec: shortCodecName(codecs.get(out.codecId) ?? ''),
      limitation: String(out.qualityLimitationReason ?? 'none'),
      width: Number(out.frameWidth ?? 0),
      height: Number(out.frameHeight ?? 0)
    }
  }
}
