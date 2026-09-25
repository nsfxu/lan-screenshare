/**
 * TCP fallback transport for networks where WebRTC/UDP is blocked (some VPNs
 * and corporate firewalls). The host encodes with WebCodecs (hardware H.264
 * when available) and pushes encoded chunks through the room's WebSocket;
 * viewers decode with WebCodecs into a MediaStreamTrack, so the same <video>
 * element renders both transports.
 *
 * System audio travels the same way as Opus (WebCodecs AudioEncoder/Decoder).
 *
 * Packet layout (little endian):
 *   u8  kind (1 = video, 2 = audio)   u8  flags (bit0 = keyframe, video only)
 *   f64 capture wall-clock ms
 *   u16 width  / audio sample rate    u16 height / audio channel count
 *   u8  codec string length    codec string (ascii)    ...chunk bytes
 */
import { BINARY_FLAG_KEY, BINARY_KIND_AUDIO, BINARY_KIND_VIDEO } from '../../shared/constants'
import {
  AdaptiveController,
  limitPreset,
  MIN_VIDEO_BITRATE,
  NO_VIEW_LIMIT,
  qualityLadder,
  scaledSize,
  type QualityPreset,
  type ViewLimit
} from '../../shared/quality'
import type { QualityPresetId } from '../../shared/quality'

const HEADER_FIXED = 1 + 1 + 8 + 2 + 2 + 1
const KEYFRAME_INTERVAL_S = 4
const LOCAL_BUFFER_LIMIT = 4 * 1024 * 1024

interface Sink {
  sendBinary(data: ArrayBuffer | Uint8Array): boolean
  readonly bufferedAmount: number
}

function encodePacket(
  kind: number,
  key: boolean,
  captureMs: number,
  width: number,
  height: number,
  codec: string,
  data: Uint8Array
): Uint8Array {
  const codecBytes = new TextEncoder().encode(codec)
  const buf = new Uint8Array(HEADER_FIXED + codecBytes.length + data.byteLength)
  const view = new DataView(buf.buffer)
  view.setUint8(0, kind)
  view.setUint8(1, key ? BINARY_FLAG_KEY : 0)
  view.setFloat64(2, captureMs, true)
  view.setUint16(10, width, true)
  view.setUint16(12, height, true)
  view.setUint8(14, codecBytes.length)
  buf.set(codecBytes, HEADER_FIXED)
  buf.set(data, HEADER_FIXED + codecBytes.length)
  return buf
}

interface DecodedPacket {
  kind: number
  key: boolean
  captureMs: number
  width: number
  height: number
  codec: string
  data: Uint8Array
}

function decodePacket(buffer: ArrayBuffer): DecodedPacket | null {
  if (buffer.byteLength < HEADER_FIXED) return null
  const view = new DataView(buffer)
  const kind = view.getUint8(0)
  if (kind !== BINARY_KIND_VIDEO && kind !== BINARY_KIND_AUDIO) return null
  const codecLen = view.getUint8(14)
  if (buffer.byteLength < HEADER_FIXED + codecLen) return null
  return {
    kind,
    key: (view.getUint8(1) & BINARY_FLAG_KEY) !== 0,
    captureMs: view.getFloat64(2, true),
    width: view.getUint16(10, true),
    height: view.getUint16(12, true),
    codec: new TextDecoder().decode(new Uint8Array(buffer, HEADER_FIXED, codecLen)),
    data: new Uint8Array(buffer, HEADER_FIXED + codecLen)
  }
}

/** Candidate encoder configs, best first. Level 5.2 covers up to 4K@60. */
const ENCODER_CODECS = ['avc1.42E034', 'avc1.640034', 'vp09.00.51.08', 'vp8']

// ---------------------------------------------------------------------------

export class TcpEncoder {
  private encoder: VideoEncoder | null = null
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null
  private configuredFor = ''
  private codec = ''
  private forceKey = true
  private lastFrameAt = 0
  private framesSinceKey = 0
  private paused = false
  private stopped = false
  /** Share of the streamer's upload budget (bits/s); null = unlimited. */
  private bitrateCap: number | null = null
  /** What the TCP watchers need at most (the encode is shared between them). */
  private view: ViewLimit = NO_VIEW_LIMIT
  private readonly captureTimes = new Map<number, number>()
  private controller: AdaptiveController
  private encodeStarts = new Map<number, number>()
  /** Rolling average encode time in ms (for the stats overlay). */
  encodeMs: number | null = null
  width = 0
  height = 0
  hardware = false
  sentBytes = 0

  constructor(
    private track: MediaStreamTrack,
    private readonly sink: Sink,
    maxQuality: QualityPresetId,
    adaptive: boolean,
    private readonly log: (msg: string) => void
  ) {
    this.controller = TcpEncoder.controllerFor(maxQuality, adaptive)
    void this.pump()
  }

  private static controllerFor(maxQuality: QualityPresetId, adaptive: boolean): AdaptiveController {
    const ladder = qualityLadder(maxQuality)
    return new AdaptiveController(adaptive ? ladder : ladder.slice(0, 1), Date.now())
  }

  /** The adaptive preset, limited to what the TCP watchers display. */
  get preset(): QualityPreset {
    return limitPreset(this.controller.preset, this.track.getSettings().height ?? 1080, this.view)
  }

  /** New maximum quality (or adaptive on/off) mid-share. */
  setQuality(maxQuality: QualityPresetId, adaptive: boolean): void {
    this.controller = TcpEncoder.controllerFor(maxQuality, adaptive)
    this.configuredFor = ''
  }

  setViewLimit(view: ViewLimit): void {
    if (view.height === this.view.height && view.fps === this.view.fps) return
    this.view = view
    this.configuredFor = ''
  }

  get codecName(): string {
    return this.codec
  }

  requestKeyframe(): void {
    this.forceKey = true
  }

  setBitrateCap(cap: number | null): void {
    if (cap === this.bitrateCap) return
    this.bitrateCap = cap
    this.configuredFor = '' // reconfigure on the next frame
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (!paused) this.forceKey = true
  }

  replaceTrack(track: MediaStreamTrack): void {
    this.track = track
    void this.reader?.cancel()
    this.controller.reset(Date.now())
    this.forceKey = true
    void this.pump()
  }

  /** Server feedback: frames sent vs dropped for slow viewers over the last period. */
  feedback(sent: number, dropped: number): void {
    const total = sent + dropped
    const lossPct = total > 0 ? (dropped / total) * 100 : 0
    const decision = this.controller.update({ lossPct, rttMs: null, limitation: 'none' }, Date.now())
    if (decision !== 'hold') {
      this.log(`tcp quality ${decision} -> ${this.controller.preset.id}`)
      this.configuredFor = ''
    }
  }

  stop(): void {
    this.stopped = true
    void this.reader?.cancel()
    try {
      this.encoder?.close()
    } catch {
      // already closed
    }
    this.encoder = null
  }

  private async pump(): Promise<void> {
    const processor = new MediaStreamTrackProcessor({ track: this.track })
    const reader = processor.readable.getReader()
    this.reader = reader
    try {
      while (!this.stopped && this.reader === reader) {
        const { value: frame, done } = await reader.read()
        if (done || !frame) break
        try {
          await this.handleFrame(frame)
        } finally {
          frame.close()
        }
      }
    } catch (err) {
      if (!this.stopped) this.log(`tcp encoder pump error: ${String(err)}`)
    }
  }

  private async handleFrame(frame: VideoFrame): Promise<void> {
    if (this.paused) return
    const preset = limitPreset(this.controller.preset, frame.displayHeight, this.view)
    const now = performance.now()
    if (now - this.lastFrameAt < 1000 / preset.fps - 2) return
    this.lastFrameAt = now

    const size = scaledSize(preset, frame.displayWidth, frame.displayHeight)
    const configKey = `${size.width}x${size.height}@${preset.fps}:${preset.maxBitrate}:${this.bitrateCap ?? 0}`
    if (configKey !== this.configuredFor) {
      if (!(await this.configure(size.width, size.height, preset))) return
      this.configuredFor = configKey
      this.forceKey = true
    }
    const encoder = this.encoder
    if (!encoder || encoder.state !== 'configured') return

    // Skip frames when the encoder or the socket falls behind: latency beats smoothness.
    if (encoder.encodeQueueSize > 2 || this.sink.bufferedAmount > LOCAL_BUFFER_LIMIT) {
      this.forceKey = true
      return
    }

    const keyFrame = this.forceKey || this.framesSinceKey >= preset.fps * KEYFRAME_INTERVAL_S
    this.forceKey = false
    this.framesSinceKey = keyFrame ? 0 : this.framesSinceKey + 1
    this.captureTimes.set(frame.timestamp, Date.now())
    this.encodeStarts.set(frame.timestamp, performance.now())
    if (this.captureTimes.size > 120) {
      const first = this.captureTimes.keys().next().value as number
      this.captureTimes.delete(first)
      this.encodeStarts.delete(first)
    }
    // The encoder scales frames to its configured size itself.
    encoder.encode(frame, { keyFrame })
  }

  private async configure(width: number, height: number, preset: QualityPreset): Promise<boolean> {
    try {
      this.encoder?.close()
    } catch {
      // ignore
    }
    this.encoder = null
    const base = {
      width,
      height,
      bitrate: Math.max(MIN_VIDEO_BITRATE, Math.min(preset.maxBitrate, this.bitrateCap ?? Infinity)),
      framerate: preset.fps,
      latencyMode: 'realtime' as const,
      avc: { format: 'annexb' as const }
    }
    for (const codec of ENCODER_CODECS) {
      for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
        const config: VideoEncoderConfig = { ...base, codec, hardwareAcceleration }
        try {
          const support = await VideoEncoder.isConfigSupported(config)
          if (!support.supported) continue
        } catch {
          continue
        }
        const encoder = new VideoEncoder({
          output: (chunk) => this.onChunk(chunk),
          error: (err) => {
            this.log(`tcp encoder error: ${err.message}`)
            this.configuredFor = ''
          }
        })
        encoder.configure(config)
        this.encoder = encoder
        this.codec = codec
        this.width = width
        this.height = height
        this.hardware = hardwareAcceleration === 'prefer-hardware'
        this.log(`tcp encoder: ${codec} ${width}x${height}@${preset.fps} hw=${this.hardware}`)
        return true
      }
    }
    this.log('tcp encoder: no supported configuration')
    return false
  }

  private onChunk(chunk: EncodedVideoChunk): void {
    const data = new Uint8Array(chunk.byteLength)
    chunk.copyTo(data)
    const captureMs = this.captureTimes.get(chunk.timestamp) ?? Date.now()
    const started = this.encodeStarts.get(chunk.timestamp)
    if (started !== undefined) {
      const ms = performance.now() - started
      this.encodeMs = this.encodeMs === null ? ms : this.encodeMs * 0.9 + ms * 0.1
    }
    this.captureTimes.delete(chunk.timestamp)
    this.encodeStarts.delete(chunk.timestamp)
    const packet = encodePacket(BINARY_KIND_VIDEO, chunk.type === 'key', captureMs, this.width, this.height, this.codec, data)
    if (this.sink.sendBinary(packet)) this.sentBytes += packet.byteLength
    else this.forceKey = true
  }
}

// ---------------------------------------------------------------------------

const AUDIO_BITRATE = 128_000

/** Opus-encodes the captured system audio for TCP-fallback viewers. */
export class TcpAudioEncoder {
  private encoder: AudioEncoder | null = null
  private reader: ReadableStreamDefaultReader<AudioData> | null = null
  private configuredFor = ''
  private muted = false
  private stopped = false
  sentBytes = 0

  constructor(
    private track: MediaStreamTrack,
    private readonly sink: Sink,
    private readonly log: (msg: string) => void
  ) {
    void this.pump()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  replaceTrack(track: MediaStreamTrack): void {
    this.track = track
    void this.reader?.cancel()
    void this.pump()
  }

  stop(): void {
    this.stopped = true
    void this.reader?.cancel()
    try {
      this.encoder?.close()
    } catch {
      // already closed
    }
    this.encoder = null
  }

  private async pump(): Promise<void> {
    const processor = new MediaStreamTrackProcessor<AudioData>({ track: this.track })
    const reader = processor.readable.getReader()
    this.reader = reader
    try {
      while (!this.stopped && this.reader === reader) {
        const { value: data, done } = await reader.read()
        if (done || !data) break
        try {
          await this.handle(data)
        } finally {
          data.close()
        }
      }
    } catch (err) {
      if (!this.stopped) this.log(`tcp audio pump error: ${String(err)}`)
    }
  }

  private async handle(data: AudioData): Promise<void> {
    if (this.muted) return
    const key = `${data.sampleRate}x${data.numberOfChannels}`
    if (key !== this.configuredFor) {
      this.configuredFor = key
      if (!(await this.configure(data.sampleRate, data.numberOfChannels))) return
    }
    const encoder = this.encoder
    if (!encoder || encoder.state !== 'configured') return
    // Audio is small; only drop it when the socket is badly backed up.
    if (encoder.encodeQueueSize > 10 || this.sink.bufferedAmount > LOCAL_BUFFER_LIMIT) return
    encoder.encode(data)
  }

  private async configure(sampleRate: number, numberOfChannels: number): Promise<boolean> {
    try {
      this.encoder?.close()
    } catch {
      // ignore
    }
    this.encoder = null
    const channels = Math.min(2, numberOfChannels)
    const config: AudioEncoderConfig = { codec: 'opus', sampleRate, numberOfChannels: channels, bitrate: AUDIO_BITRATE }
    try {
      if (!(await AudioEncoder.isConfigSupported(config)).supported) {
        this.log(`tcp audio: opus ${sampleRate} Hz x${channels} not supported`)
        return false
      }
    } catch {
      return false
    }
    const encoder = new AudioEncoder({
      output: (chunk) => {
        const bytes = new Uint8Array(chunk.byteLength)
        chunk.copyTo(bytes)
        const packet = encodePacket(BINARY_KIND_AUDIO, false, Date.now(), sampleRate, channels, 'opus', bytes)
        if (this.sink.sendBinary(packet)) this.sentBytes += packet.byteLength
      },
      error: (err) => {
        this.log(`tcp audio encoder error: ${err.message}`)
        this.configuredFor = ''
      }
    })
    encoder.configure(config)
    this.encoder = encoder
    this.log(`tcp audio encoder: opus ${sampleRate} Hz x${channels}`)
    return true
  }
}

// ---------------------------------------------------------------------------

export interface TcpDecoderStats {
  framesDecoded: number
  framesDropped: number
  bytes: number
  latencyMs: number | null
  width: number
  height: number
  codec: string
  audioBytes: number
}

export class TcpDecoder {
  readonly stream: MediaStream
  private readonly generator: MediaStreamTrackGenerator
  private readonly writer: WritableStreamDefaultWriter<VideoFrame>
  private decoder: VideoDecoder | null = null
  private configuredCodec = ''
  private waitingKey = true
  private readonly captureTimes = new Map<number, number>()
  private timestamp = 0
  private closed = false
  private readonly audioGenerator: MediaStreamTrackGenerator<AudioData>
  private readonly audioWriter: WritableStreamDefaultWriter<AudioData>
  private audioDecoder: AudioDecoder | null = null
  private audioConfig = ''
  readonly stats: TcpDecoderStats = {
    framesDecoded: 0,
    framesDropped: 0,
    bytes: 0,
    latencyMs: null,
    width: 0,
    height: 0,
    codec: '',
    audioBytes: 0
  }

  constructor(
    private readonly clockOffset: () => number,
    private readonly requestKeyframe: () => void,
    private readonly log: (msg: string) => void
  ) {
    this.generator = new MediaStreamTrackGenerator({ kind: 'video' })
    this.writer = this.generator.writable.getWriter()
    // The audio track exists from the start (silent until audio arrives) so the
    // <video> element never has to pick up a track added mid-playback.
    this.audioGenerator = new MediaStreamTrackGenerator<AudioData>({ kind: 'audio' })
    this.audioWriter = this.audioGenerator.writable.getWriter()
    this.stream = new MediaStream([this.generator, this.audioGenerator])
  }

  push(buffer: ArrayBuffer): void {
    if (this.closed) return
    const packet = decodePacket(buffer)
    if (!packet) return
    if (packet.kind === BINARY_KIND_AUDIO) {
      this.pushAudio(packet)
      return
    }
    this.stats.bytes += buffer.byteLength

    if (packet.codec !== this.configuredCodec || !this.decoder || this.decoder.state === 'closed') {
      if (!packet.key) {
        this.stats.framesDropped++
        this.requestKeyframe()
        return
      }
      this.configure(packet.codec)
    }
    const decoder = this.decoder
    if (!decoder) return

    if (this.waitingKey && !packet.key) {
      this.stats.framesDropped++
      return
    }
    // Decoder falling behind: drop until the next keyframe to stay live.
    if (decoder.decodeQueueSize > 3 && !packet.key) {
      this.waitingKey = true
      this.stats.framesDropped++
      this.requestKeyframe()
      return
    }
    this.waitingKey = false
    this.timestamp += 16_666
    this.captureTimes.set(this.timestamp, packet.captureMs)
    if (this.captureTimes.size > 120) this.captureTimes.delete(this.captureTimes.keys().next().value as number)
    this.stats.width = packet.width
    this.stats.height = packet.height
    try {
      decoder.decode(new EncodedVideoChunk({ type: packet.key ? 'key' : 'delta', timestamp: this.timestamp, data: packet.data }))
    } catch (err) {
      this.log(`tcp decode failed: ${String(err)}`)
      this.reset()
    }
  }

  close(): void {
    this.closed = true
    try {
      this.decoder?.close()
    } catch {
      // ignore
    }
    try {
      this.audioDecoder?.close()
    } catch {
      // ignore
    }
    void this.writer.close().catch(() => {})
    void this.audioWriter.close().catch(() => {})
    this.generator.stop()
    this.audioGenerator.stop()
  }

  private pushAudio(packet: DecodedPacket): void {
    this.stats.audioBytes += packet.data.byteLength
    const sampleRate = packet.width
    const numberOfChannels = packet.height
    const key = `${packet.codec}/${sampleRate}/${numberOfChannels}`
    if (key !== this.audioConfig || !this.audioDecoder || this.audioDecoder.state === 'closed') {
      try {
        this.audioDecoder?.close()
      } catch {
        // ignore
      }
      const decoder = new AudioDecoder({
        output: (data) => {
          if (this.closed || this.audioWriter.desiredSize === null || this.audioWriter.desiredSize <= 0) {
            data.close()
            return
          }
          this.audioWriter.write(data).catch(() => data.close())
        },
        error: (err) => {
          this.log(`tcp audio decoder error: ${err.message}`)
          this.audioConfig = ''
        }
      })
      decoder.configure({ codec: packet.codec, sampleRate, numberOfChannels })
      this.audioDecoder = decoder
      this.audioConfig = key
    }
    try {
      this.audioDecoder.decode(
        new EncodedAudioChunk({ type: 'key', timestamp: Math.round(packet.captureMs * 1000), data: packet.data })
      )
    } catch (err) {
      this.log(`tcp audio decode failed: ${String(err)}`)
      this.audioConfig = ''
    }
  }

  private configure(codec: string): void {
    try {
      this.decoder?.close()
    } catch {
      // ignore
    }
    const decoder = new VideoDecoder({
      output: (frame) => this.onFrame(frame),
      error: (err) => {
        this.log(`tcp decoder error: ${err.message}`)
        this.reset()
      }
    })
    decoder.configure({ codec, hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true })
    this.decoder = decoder
    this.configuredCodec = codec
    this.stats.codec = codec
    this.waitingKey = true
  }

  private reset(): void {
    this.configuredCodec = ''
    this.waitingKey = true
    this.requestKeyframe()
  }

  private onFrame(frame: VideoFrame): void {
    const capture = this.captureTimes.get(frame.timestamp)
    this.captureTimes.delete(frame.timestamp)
    if (capture !== undefined) {
      const latency = Date.now() + this.clockOffset() - capture
      if (latency >= 0 && latency < 10_000) {
        this.stats.latencyMs = this.stats.latencyMs === null ? latency : this.stats.latencyMs * 0.8 + latency * 0.2
      }
    }
    this.stats.framesDecoded++
    if (this.closed || this.writer.desiredSize === null || this.writer.desiredSize <= 0) {
      frame.close()
      this.stats.framesDropped++
      return
    }
    this.writer.write(frame).catch(() => frame.close())
  }
}
