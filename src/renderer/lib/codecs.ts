import type { CodecSupport } from '../../shared/types'
export { chooseCodecOrder, mungeBitrates, shortCodecName } from '../../shared/codecs'

const ALL = ['video/H264', 'video/H265', 'video/VP9', 'video/AV1', 'video/VP8']
const AUX = new Set(['video/rtx', 'video/red', 'video/ulpfec', 'video/flexfec-03'])

const probeConfig = { width: 1920, height: 1080, bitrate: 10_000_000, framerate: 60 }

function available(kind: 'sender' | 'receiver'): string[] {
  const caps = (kind === 'sender' ? RTCRtpSender : RTCRtpReceiver).getCapabilities('video')
  const seen = new Set((caps?.codecs ?? []).map((c) => c.mimeType.toLowerCase()))
  return ALL.filter((m) => seen.has(m.toLowerCase()))
}

async function probe(kind: 'encode' | 'decode'): Promise<CodecSupport[]> {
  const mimes = available(kind === 'encode' ? 'sender' : 'receiver')
  return Promise.all(
    mimes.map(async (mimeType) => {
      try {
        const video = { contentType: mimeType, ...probeConfig }
        const info =
          kind === 'encode'
            ? await navigator.mediaCapabilities.encodingInfo({ type: 'webrtc', video } as MediaEncodingConfiguration)
            : await navigator.mediaCapabilities.decodingInfo({ type: 'webrtc', video } as MediaDecodingConfiguration)
        return { mimeType, hardware: info.supported && info.powerEfficient }
      } catch {
        return { mimeType, hardware: false }
      }
    })
  )
}

/** Codecs this machine can encode for WebRTC, flagged when hardware-backed. */
export const detectEncoders = (): Promise<CodecSupport[]> => probe('encode')
/** Codecs this machine can decode for WebRTC, flagged when hardware-backed. */
export const detectDecoders = (): Promise<CodecSupport[]> => probe('decode')

/** Apply a mime-type order to a transceiver, keeping RTX/RED/FEC entries. */
export function applyCodecOrder(transceiver: RTCRtpTransceiver, order: string[]): void {
  const codecs = RTCRtpSender.getCapabilities('video')?.codecs ?? []
  const rank = (c: RTCRtpCodec): number => {
    const idx = order.findIndex((m) => m.toLowerCase() === c.mimeType.toLowerCase())
    if (idx >= 0) {
      // Among H.264 profiles prefer packetization-mode=1 constrained baseline:
      // it is what every hardware encoder/decoder pair supports.
      const fmtp = c.sdpFmtpLine ?? ''
      const h264Bonus = /packetization-mode=1/.test(fmtp) ? 0 : 0.5
      const baseline = /profile-level-id=42e0/i.test(fmtp) ? 0 : 0.25
      return idx + (c.mimeType === 'video/H264' ? h264Bonus + baseline : 0)
    }
    return AUX.has(c.mimeType.toLowerCase()) ? 1000 : 10_000
  }
  const sorted = codecs.filter((c) => rank(c) < 10_000).sort((a, b) => rank(a) - rank(b))
  if (sorted.length === 0) return
  try {
    transceiver.setCodecPreferences(sorted)
  } catch (err) {
    console.warn('setCodecPreferences failed', err)
  }
}
