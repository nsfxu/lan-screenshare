/**
 * TCP fallback transport for networks where WebRTC/UDP is blocked (some VPNs
 * and corporate firewalls). The host encodes with WebCodecs (hardware H.264
 * when available) and pushes encoded chunks through the room's WebSocket;
 * viewers decode with WebCodecs into a MediaStreamTrack, so the same <video>
 * element renders both transports.
 *
 * Packet layout (little endian):
 *   u8  kind (1 = video)       u8  flags (bit0 = keyframe)
 *   f64 capture wall-clock ms  u16 width  u16 height
 *   u8  codec string length    codec string (ascii)    ...chunk bytes
 */
import { BINARY_FLAG_KEY, BINARY_KIND_VIDEO } from '../../shared/constants'
import { AdaptiveController, qualityLadder, scaledSize, type QualityPreset } from '../../shared/quality'
import type { QualityPresetId } from '../../shared/quality'

const HEADER_FIXED = 1 + 1 + 8 + 2 + 2 + 1
const KEYFRAME_INTERVAL_S = 4
const LOCAL_BUFFER_LIMIT = 4 * 1024 * 1024

interface Sink {
  sendBinary(data: ArrayBuffer | Uint8Array): boolean
  readonly bufferedAmount: number
}

function encodePacket(key: boolean, captureMs: number, width: number, height: number, codec: string, data: Uint8Array): Uint8Array {
  const codecBytes = new TextEncoder().encode(codec)
  const buf = new Uint8Array(HEADER_FIXED + codecBytes.length + data.byteLength)
  const view = new DataView(buf.buffer)
  view.setUint8(0, BINARY_KIND_VIDEO)
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
  if (view.getUint8(0) !== BINARY_KIND_VIDEO) return null
  const codecLen = view.getUint8(14)
  if (buffer.byteLength < HEADER_FIXED + codecLen) return null
  return {
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
  private readonly captureTimes = new Map<number, number>()
  private readonly controller: AdaptiveController
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
    const ladder = qualityLadder(maxQuality)
    this.controller = new AdaptiveController(adaptive ? ladder : ladder.slice(0, 1), Date.now())
    void this.pump()
  }

  get preset(): QualityPreset {
    return this.controller.preset
  }

  get codecName(): string {
    return this.codec
  }

  requestKeyframe(): void {
    this.forceKey = true
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
    const preset = this.controller.preset
    const now = performance.now()
    if (now - this.lastFrameAt < 1000 / preset.fps - 2) return
    this.lastFrameAt = now

    const size = scaledSize(preset, frame.displayWidth, frame.displayHeight)
    const configKey = `${size.width}x${size.height}@${preset.id}`
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
      bitrate: preset.maxBitrate,
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
    const packet = encodePacket(chunk.type === 'key', captureMs, this.width, this.height, this.codec, data)
    if (this.sink.sendBinary(packet)) this.sentBytes += packet.byteLength
    else this.forceKey = true
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
  readonly stats: TcpDecoderStats = {
    framesDecoded: 0,
    framesDropped: 0,
    bytes: 0,
    latencyMs: null,
    width: 0,
    height: 0,
    codec: ''
  }

  constructor(
    private readonly clockOffset: () => number,
    private readonly requestKeyframe: () => void,
    private readonly log: (msg: string) => void
  ) {
    this.generator = new MediaStreamTrackGenerator({ kind: 'video' })
    this.writer = this.generator.writable.getWriter()
    this.stream = new MediaStream([this.generator])
  }

  push(buffer: ArrayBuffer): void {
    if (this.closed) return
    const packet = decodePacket(buffer)
    if (!packet) return
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
    void this.writer.close().catch(() => {})
    this.generator.stop()
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
