import { SNAPSHOT_INTERVAL_MS, SNAPSHOT_MAX_CHARS, SNAPSHOT_WIDTH, STATS_INTERVAL_MS } from '../../shared/constants'
import { AdaptiveController, encodingFor, encodingForWatcher, getPreset, qualityLadder, splitBudget } from '../../shared/quality'
import type {
  CodecSupport,
  HostStats,
  MediaState,
  ServerMessage,
  SignalData,
  Settings,
  Transport,
  ViewerStats
} from '../../shared/types'
import { applyCodecOrder, chooseCodecOrder, mungeBitrates, mungeOpus, shortCodecName } from './codecs'
import { Emitter } from './emitter'
import { startNativeLoopback, type NativeAudioCapture } from './nativeAudio'
import type { RoomClient } from './roomClient'
import { TcpAudioEncoder, TcpEncoder } from './tcpStream'

interface Peer {
  pc: RTCPeerConnection
  sender: RTCRtpSender
  audioSender: RTCRtpSender
  controller: AdaptiveController
  pendingCandidates: RTCIceCandidateInit[]
  remoteSet: boolean
  prev: { ts: number; bytes: number; audioBytes: number; encodeTime: number; framesEncoded: number } | null
  sample: PeerSample | null
  /** Last parameters applied, to skip redundant setParameters calls. */
  applied: string
}

interface PeerSample {
  bitrateKbps: number
  audioKbps: number
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

export interface SharingState {
  sharing: boolean
  paused: boolean
  /** System audio was captured with the current source. */
  hasAudio: boolean
  audioMuted: boolean
}

/** What a watcher reports about receiving this publisher's stream. */
export interface WatcherInfo {
  stats: ViewerStats | null
  mediaState: MediaState
}

type Events = {
  stream: MediaStream | null
  sharing: SharingState
  stats: HostStats
  watchers: Map<string, WatcherInfo>
  /** The host stopped this stream; carries the reason to show. */
  stopped: string
  error: string
}

/** Opus ceiling per viewer; the SDP asks for 128 kbps average. */
const AUDIO_MAX_BITRATE = 160_000

const log = (msg: string): void => {
  console.info(`[publisher] ${msg}`)
  window.api.system.log('info', `[publisher] ${msg}`)
}

/**
 * Sending side of a participant's screen share (anyone in a room can share).
 * Captures the chosen screen/window (plus system audio) once and fans it out
 * to each watcher with its own RTCPeerConnection, so every watcher gets its
 * own congestion control and adaptive quality. One shared WebCodecs encoder
 * pair serves watchers on the TCP fallback.
 */
export class Publisher extends Emitter<Events> {
  stream: MediaStream | null = null
  paused = false
  audioMuted = false
  /** Why system audio could not be captured with the current source (DOMException name). */
  audioError: string | null = null
  sourceId: string | null = null
  readonly watchers = new Map<string, WatcherInfo>()
  lastStats: HostStats | null = null

  private track: MediaStreamTrack | null = null
  private audioTrack: MediaStreamTrack | null = null
  /** Windows helper capture, used when Chromium loopback rejects the device format. */
  private nativeAudio: NativeAudioCapture | null = null
  private preferNativeAudio = false
  private readonly peers = new Map<string, Peer>()
  /** Pixel height each watcher displays us at (null = full); may arrive before its peer exists. */
  private readonly viewHeights = new Map<string, number | null>()
  private readonly tcpViewers = new Set<string>()
  private tcp: TcpEncoder | null = null
  private tcpAudio: TcpAudioEncoder | null = null
  private tcpPrev: { ts: number; bytes: number; audioBytes: number } | null = null
  private readonly statsTimer: number
  private readonly unsubscribe: () => void
  private tick = 0
  private readonly snapshotTimer: number
  private snapshotSoon: number | null = null
  private disposed = false

  constructor(
    private readonly client: RoomClient,
    private settings: Settings,
    private readonly encoders: CodecSupport[]
  ) {
    super()
    this.unsubscribe = client.on('message', (m) => void this.onMessage(m))
    this.statsTimer = window.setInterval(() => void this.collectStats(), STATS_INTERVAL_MS)
    this.snapshotTimer = window.setInterval(() => void this.sendSnapshot(), SNAPSHOT_INTERVAL_MS)
  }

  get sharing(): boolean {
    return !!this.track
  }

  get hasAudio(): boolean {
    return !!this.audioTrack
  }

  get state(): SharingState {
    return { sharing: !!this.track, paused: this.paused, hasAudio: !!this.audioTrack, audioMuted: this.audioMuted }
  }

  updateSettings(settings: Settings): void {
    this.settings = settings
    if (this.track) this.track.contentHint = settings.contentHint
    void this.rebalance()
  }

  /**
   * Start capturing (or switch to another source without renegotiating).
   * With `withAudio`, system audio is captured too; if the platform refuses
   * audio, sharing continues video-only.
   */
  async startCapture(sourceId: string, withAudio = this.settings.shareAudio): Promise<void> {
    const preset = getPreset(this.settings.maxQuality)
    const video: MediaTrackConstraints = { frameRate: { ideal: preset.fps, max: preset.fps } }
    if (preset.height > 0) video.height = { max: preset.height }
    // System audio should reach viewers untouched: no voice processing.
    const audio: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
      sampleRate: 48_000
    }

    let stream: MediaStream
    let native: NativeAudioCapture | null = null
    this.audioError = null
    // Once Chromium's loopback has failed on this device, go straight to the helper.
    const chromiumAudio = withAudio && !this.preferNativeAudio
    await window.api.capture.select(sourceId, chromiumAudio)
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: chromiumAudio ? audio : false })
    } catch (err) {
      if (!chromiumAudio) throw err
      this.audioError = err instanceof DOMException ? err.name : String(err)
      log(`capture with audio failed (${String(err)}); retrying video only`)
      await window.api.capture.select(sourceId, false)
      stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false })
    }
    // Windows: Chromium can't open surround (5.1/7.1) devices for loopback, but
    // the native helper can (it downmixes to stereo).
    const needNative = withAudio && (this.preferNativeAudio || this.audioError === 'NotReadableError')
    if (needNative && stream.getAudioTracks().length === 0 && (await window.api.capture.nativeAudio.available())) {
      this.nativeAudio?.stop() // the helper is a single process; free it first
      this.nativeAudio = null
      try {
        native = await startNativeLoopback(log)
        stream.addTrack(native.track)
        this.audioError = null
        this.preferNativeAudio = true
      } catch (err) {
        log(`native loopback failed: ${String(err)}`)
        this.audioError ??= 'NotReadableError'
      }
    }
    if (this.disposed) {
      native?.stop()
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    const track = stream.getVideoTracks()[0]
    const audioTrack = stream.getAudioTracks()[0] ?? null
    track.contentHint = this.settings.contentHint
    track.addEventListener('ended', () => {
      if (this.track === track) this.stopSharing()
    })
    if (audioTrack) audioTrack.contentHint = 'music'
    const s = track.getSettings()
    const a = audioTrack?.getSettings()
    log(
      `capturing ${s.width}x${s.height}@${s.frameRate} from ${sourceId}` +
        (audioTrack
          ? native
            ? ' + audio (native loopback)'
            : ` + audio ${a?.sampleRate ?? '?'} Hz x${a?.channelCount ?? '?'}`
          : withAudio
            ? ' (no audio available)'
            : '')
    )

    const oldVideo = this.track
    const oldAudio = this.audioTrack
    const oldNative = this.nativeAudio
    this.nativeAudio = native
    this.stream = stream
    this.track = track
    this.audioTrack = audioTrack
    this.sourceId = sourceId

    if (oldVideo) {
      // Source switch: swap tracks on every live connection.
      for (const peer of this.peers.values()) {
        await peer.sender.replaceTrack(this.paused ? null : track).catch(() => {})
        await peer.audioSender.replaceTrack(this.audioSendTrack()).catch(() => {})
        peer.controller.reset(Date.now())
        peer.applied = ''
      }
      await this.rebalance()
      this.tcp?.replaceTrack(track)
      this.syncTcpAudio()
      oldVideo.stop()
      oldAudio?.stop()
      oldNative?.stop()
    }
    this.emit('stream', stream)
    this.publishSharing()
    this.snapshotShortly()
  }

  setPaused(paused: boolean): void {
    if (!this.track || this.paused === paused) return
    this.paused = paused
    for (const peer of this.peers.values()) {
      void peer.sender.replaceTrack(paused ? null : this.track).catch(() => {})
      void peer.audioSender.replaceTrack(this.audioSendTrack()).catch(() => {})
    }
    this.tcp?.setPaused(paused)
    this.tcpAudio?.setMuted(paused || this.audioMuted)
    this.publishSharing()
    if (!paused) this.snapshotShortly()
  }

  /** Stop sending system audio while the screen keeps streaming. */
  setAudioMuted(muted: boolean): void {
    if (this.audioMuted === muted) return
    this.audioMuted = muted
    for (const peer of this.peers.values()) void peer.audioSender.replaceTrack(this.audioSendTrack()).catch(() => {})
    this.tcpAudio?.setMuted(this.paused || muted)
    this.publishSharing()
  }

  /** Stop capturing; viewers stay in the room and see "not sharing". */
  stopSharing(): void {
    for (const id of [...this.peers.keys()]) this.closePeer(id)
    this.tcp?.stop()
    this.tcp = null
    this.tcpAudio?.stop()
    this.tcpAudio = null
    this.tcpViewers.clear()
    this.track?.stop()
    this.audioTrack?.stop()
    this.nativeAudio?.stop()
    this.nativeAudio = null
    this.track = null
    this.audioTrack = null
    this.stream = null
    this.paused = false
    this.sourceId = null
    this.watchers.clear()
    this.emit('watchers', this.watchers)
    this.emit('stream', null)
    this.publishSharing()
  }

  dispose(): void {
    this.disposed = true
    this.stopSharing()
    this.unsubscribe()
    clearInterval(this.statsTimer)
    clearInterval(this.snapshotTimer)
    if (this.snapshotSoon) clearTimeout(this.snapshotSoon)
    this.removeAllListeners()
  }

  /** Send a preview soon (the first frames after starting can still be black). */
  private snapshotShortly(): void {
    if (this.snapshotSoon) clearTimeout(this.snapshotSoon)
    this.snapshotSoon = window.setTimeout(() => {
      this.snapshotSoon = null
      void this.sendSnapshot()
    }, 1200)
  }

  /** Share a small JPEG preview of the current frame with the room. */
  private async sendSnapshot(): Promise<void> {
    const track = this.track
    if (!track || this.paused || track.readyState !== 'live') return
    try {
      const bitmap = await new ImageCapture(track).grabFrame()
      const width = Math.min(SNAPSHOT_WIDTH, bitmap.width)
      const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width))
      const canvas = new OffscreenCanvas(width, height)
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
      bitmap.close()
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 })
      const image = await blobToDataUrl(blob)
      if (this.track === track && image.length <= SNAPSHOT_MAX_CHARS) this.client.send({ type: 'snapshot', image })
    } catch (err) {
      log(`snapshot failed: ${String(err)}`)
    }
  }

  /** The audio track viewers should currently receive (null = silence). */
  private audioSendTrack(): MediaStreamTrack | null {
    return this.paused || this.audioMuted ? null : this.audioTrack
  }

  private publishSharing(): void {
    const state = this.state
    const audio = state.sharing && state.hasAudio && !state.audioMuted && !state.paused
    this.client.send({ type: 'stream-state', sharing: state.sharing, paused: state.paused, audio })
    this.emit('sharing', state)
  }

  private async onMessage(msg: ServerMessage): Promise<void> {
    switch (msg.type) {
      case 'welcome':
        // Reconnected: the server ended our stream when we dropped. Announce it
        // again (watchers re-subscribe) and forget the old connections.
        for (const id of [...this.peers.keys()]) this.closePeer(id)
        for (const id of [...this.tcpViewers]) this.removeTcpViewer(id)
        this.watchers.clear()
        this.emit('watchers', this.watchers)
        if (this.track) this.publishSharing()
        return
      case 'stream-stopped':
        log(`stream stopped by host: ${msg.reason}`)
        this.stopSharing()
        this.emit('stopped', msg.reason)
        return
      case 'watch-request':
        if (!this.track) return
        this.watchers.set(msg.from, { stats: null, mediaState: 'negotiating' })
        this.emit('watchers', this.watchers)
        return this.connect(msg.from, msg.transport, msg.decoders)
      case 'signal': {
        // Signals for connections where we are the watcher belong to a Subscription.
        if (msg.stream !== this.client.selfId) return
        const peer = this.peers.get(msg.from)
        if (!peer) return
        if (msg.data.kind === 'answer') {
          const preset = peer.controller.preset
          const sdp = mungeOpus(
            mungeBitrates(msg.data.sdp, Math.min(preset.maxBitrate * 0.6, 8_000_000) / 1000, 300)
          )
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
      case 'watcher-view':
        this.viewHeights.set(msg.from, msg.height)
        void this.rebalance()
        return
      case 'watcher-left':
        this.closePeer(msg.id)
        this.removeTcpViewer(msg.id)
        this.viewHeights.delete(msg.id)
        this.watchers.delete(msg.id)
        this.emit('watchers', this.watchers)
        return
      case 'watcher-stats':
        this.watchers.set(msg.from, { stats: msg.stats, mediaState: msg.mediaState })
        this.emit('watchers', this.watchers)
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
      this.syncTcpAudio()
      this.tcp?.requestKeyframe()
      void this.rebalance()
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
    // Always negotiate an audio line (in the same stream, so WebRTC keeps
    // lip-sync). Muting or switching sources then only swaps the track.
    const audioTransceiver = pc.addTransceiver('audio', {
      direction: 'sendonly',
      streams: [this.stream],
      sendEncodings: [{ maxBitrate: AUDIO_MAX_BITRATE, priority: 'high', networkPriority: 'high' }]
    })
    await audioTransceiver.sender.replaceTrack(this.audioSendTrack())
    const order = chooseCodecOrder(this.settings.codec, this.encoders, decoders)
    applyCodecOrder(transceiver, order)
    const peer: Peer = {
      pc,
      sender: transceiver.sender,
      audioSender: audioTransceiver.sender,
      controller,
      pendingCandidates: [],
      remoteSet: false,
      prev: null,
      sample: null,
      applied: ''
    }
    this.peers.set(viewerId, peer)
    if (this.paused) await peer.sender.replaceTrack(null)

    pc.onicecandidate = (e) => {
      this.signal(viewerId, { kind: 'candidate', candidate: e.candidate?.toJSON() ?? null })
    }
    pc.onconnectionstatechange = () => {
      log(`viewer ${viewerId} connection ${pc.connectionState}`)
      if (pc.connectionState === 'failed' && this.peers.get(viewerId)?.pc === pc) this.closePeer(viewerId)
    }

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await this.rebalance()
      this.signal(viewerId, { kind: 'offer', sdp: pc.localDescription!.sdp })
      log(`offer sent to ${viewerId} (codecs: ${order.map(shortCodecName).join(' > ')}, audio: ${this.hasAudio})`)
    } catch (err) {
      log(`offer failed for ${viewerId}: ${String(err)}`)
      this.closePeer(viewerId)
    }
  }

  /**
   * Recompute every watcher's encoding: the adaptive preset, capped to what
   * that watcher displays, with the upload budget split fairly between all
   * watchers (small tiles need little, so bigger views get the rest). TCP
   * watchers share one encode and count as a single demand.
   */
  private async rebalance(): Promise<void> {
    if (!this.track) return
    const source = this.track.getSettings().height ?? 1080
    const budget = this.settings.uploadBudgetMbps > 0 ? this.settings.uploadBudgetMbps * 1_000_000 : null
    const entries = [...this.peers.entries()]
    const demands = entries.map(
      ([id, p]) =>
        encodingForWatcher(p.controller.preset, source, { viewHeight: this.viewHeights.get(id) ?? null, bitrateBudget: null })
          .maxBitrate
    )
    if (this.tcp) demands.push(this.tcp.preset.maxBitrate)
    const shares = splitBudget(budget, demands)
    this.tcp?.setBitrateCap(budget === null ? null : shares[shares.length - 1])
    await Promise.all(
      entries.map(([id, peer], i) =>
        this.applyEncoding(peer, source, {
          viewHeight: this.viewHeights.get(id) ?? null,
          bitrateBudget: budget === null ? null : shares[i]
        })
      )
    )
  }

  private async applyEncoding(peer: Peer, source: number, limits: Parameters<typeof encodingForWatcher>[2]): Promise<void> {
    const enc = encodingForWatcher(peer.controller.preset, source, limits)
    // 'motion' content keeps the frame rate and trades resolution; 'detail' keeps text sharp.
    const degradation = this.settings.contentHint === 'motion' ? 'maintain-framerate' : 'maintain-resolution'
    const key = JSON.stringify([enc, degradation])
    if (key === peer.applied) return
    const params = peer.sender.getParameters()
    if (!params.encodings?.length) return
    params.encodings[0] = { ...params.encodings[0], ...enc }
    ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = degradation
    try {
      await peer.sender.setParameters(params)
      peer.applied = key
    } catch (err) {
      log(`setParameters failed: ${String(err)}`)
    }
  }

  private signal(to: string, data: SignalData): void {
    this.client.send({ type: 'signal', to, stream: this.client.selfId, data })
  }

  private closePeer(id: string): void {
    const peer = this.peers.get(id)
    if (!peer) return
    this.peers.delete(id)
    peer.pc.onicecandidate = null
    peer.pc.onconnectionstatechange = null
    peer.pc.close()
    // The remaining watchers can use the freed budget.
    void this.rebalance()
  }

  /** Keep the TCP audio encoder in line with the captured track and TCP viewers. */
  private syncTcpAudio(): void {
    if (this.tcpViewers.size === 0 || !this.audioTrack) {
      this.tcpAudio?.stop()
      this.tcpAudio = null
      return
    }
    if (this.tcpAudio) this.tcpAudio.replaceTrack(this.audioTrack)
    else this.tcpAudio = new TcpAudioEncoder(this.audioTrack, this.client, log)
    this.tcpAudio.setMuted(this.paused || this.audioMuted)
  }

  private removeTcpViewer(id: string): void {
    if (!this.tcpViewers.delete(id)) return
    if (this.tcpViewers.size === 0) {
      this.tcp?.stop()
      this.tcp = null
      this.syncTcpAudio()
      void this.rebalance()
    }
  }

  private async collectStats(): Promise<void> {
    this.tick++
    const now = performance.now()
    await Promise.all([...this.peers.values()].map((p) => this.samplePeer(p, now)))

    let changed = false
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
        changed = true
      }
    }

    if (changed) await this.rebalance()

    const samples = [...this.peers.values()].map((p) => p.sample).filter((s): s is PeerSample => !!s)
    let tcpKbps = 0
    let tcpAudioKbps = 0
    if (this.tcp) {
      const prev = this.tcpPrev
      const audioBytes = this.tcpAudio?.sentBytes ?? 0
      if (prev) {
        tcpKbps = ((this.tcp.sentBytes - prev.bytes) * 8) / (now - prev.ts)
        tcpAudioKbps = ((audioBytes - prev.audioBytes) * 8) / (now - prev.ts)
      }
      this.tcpPrev = { ts: now, bytes: this.tcp.sentBytes, audioBytes }
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
      audioKbps: this.audioTrack
        ? Math.round(samples.reduce((sum, s) => sum + s.audioKbps, 0) + tcpAudioKbps)
        : null,
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
    if (this.tick % 2 === 0 && this.track) this.client.send({ type: 'publisher-stats', encodeMs: stats.encodeMs })
  }

  private async samplePeer(peer: Peer, now: number): Promise<void> {
    let report: RTCStatsReport
    try {
      report = await peer.pc.getStats()
    } catch {
      return
    }
    let out: Record<string, any> | undefined
    let audioOut: Record<string, any> | undefined
    let remote: Record<string, any> | undefined
    let pair: Record<string, any> | undefined
    const codecs = new Map<string, string>()
    report.forEach((s: Record<string, any>) => {
      if (s.type === 'outbound-rtp' && s.kind === 'video') out = s
      else if (s.type === 'outbound-rtp' && s.kind === 'audio') audioOut = s
      else if (s.type === 'remote-inbound-rtp' && s.kind === 'video') remote = s
      else if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s
      else if (s.type === 'codec') codecs.set(s.id, s.mimeType)
    })
    if (!out) return
    const bytes = Number(out.bytesSent ?? 0)
    const audioBytes = Number(audioOut?.bytesSent ?? 0)
    const encodeTime = Number(out.totalEncodeTime ?? 0)
    const framesEncoded = Number(out.framesEncoded ?? 0)
    const prev = peer.prev
    peer.prev = { ts: now, bytes, audioBytes, encodeTime, framesEncoded }
    if (!prev) return
    const dt = (now - prev.ts) / 1000
    const frames = framesEncoded - prev.framesEncoded
    const rtt = remote?.roundTripTime ?? pair?.currentRoundTripTime
    peer.sample = {
      bitrateKbps: dt > 0 ? ((bytes - prev.bytes) * 8) / 1000 / dt : 0,
      audioKbps: dt > 0 ? ((audioBytes - prev.audioBytes) * 8) / 1000 / dt : 0,
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
