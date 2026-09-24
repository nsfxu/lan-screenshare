import type { CodecPreference, CodecSupport } from './types'

/** Pure codec negotiation helpers (no DOM types), shared by the renderer and tests. */

const MIME: Record<Exclude<CodecPreference, 'auto'>, string> = {
  h264: 'video/H264',
  h265: 'video/H265',
  vp9: 'video/VP9',
  av1: 'video/AV1'
}

/**
 * Order codecs for one host→viewer connection.
 *
 * Auto: H.264 when the host has a hardware encoder for it; otherwise H.265 if
 * both ends have hardware support; otherwise H.264 (software), then VP9/VP8.
 * An explicit preference wins when both ends support it.
 */
export function chooseCodecOrder(
  pref: CodecPreference,
  encoders: CodecSupport[],
  decoders: CodecSupport[]
): string[] {
  const dec = new Map(decoders.map((d) => [d.mimeType.toLowerCase(), d]))
  const usable = encoders.filter((e) => decoders.length === 0 || dec.has(e.mimeType.toLowerCase()))
  const has = (mime: string): CodecSupport | undefined => usable.find((c) => c.mimeType.toLowerCase() === mime.toLowerCase())
  const hwBoth = (mime: string): boolean => !!has(mime)?.hardware && (decoders.length === 0 || !!dec.get(mime.toLowerCase())?.hardware)

  const order: string[] = []
  const push = (mime: string): void => {
    if (has(mime) && !order.includes(mime)) order.push(mime)
  }
  if (pref !== 'auto') push(MIME[pref])
  if (has('video/H264')?.hardware) push('video/H264')
  if (hwBoth('video/H265')) push('video/H265')
  push('video/H264')
  if (hwBoth('video/VP9')) push('video/VP9')
  push('video/VP8')
  push('video/VP9')
  push('video/H265')
  push('video/AV1')
  return order
}

/**
 * Raise WebRTC's conservative start/min bitrates so a LAN stream reaches full
 * quality within a second or two instead of ramping up from ~300 kbps.
 * Applied to the remote answer on the sending side.
 */
export function mungeBitrates(sdp: string, startKbps: number, minKbps: number): string {
  const lines = sdp.split('\r\n')
  let inVideo = false
  const payloads = new Set<string>()
  for (const line of lines) {
    if (line.startsWith('m=')) inVideo = line.startsWith('m=video')
    const m = inVideo && /^a=rtpmap:(\d+) ([\w-]+)\//.exec(line)
    if (m && !['rtx', 'red', 'ulpfec', 'flexfec-03'].includes(m[2].toLowerCase())) payloads.add(m[1])
  }
  const extra = `x-google-start-bitrate=${Math.round(startKbps)};x-google-min-bitrate=${Math.round(minKbps)}`
  const out: string[] = []
  const hasFmtp = new Set<string>()
  for (const line of lines) {
    const f = /^a=fmtp:(\d+) (.*)$/.exec(line)
    if (f && payloads.has(f[1]) && !line.includes('x-google-start-bitrate')) {
      hasFmtp.add(f[1])
      out.push(`${line};${extra}`)
    } else out.push(line)
  }
  // Codecs without an fmtp line (e.g. VP8) get one right after their rtpmap.
  const result: string[] = []
  for (const line of out) {
    result.push(line)
    const m = /^a=rtpmap:(\d+) /.exec(line)
    if (m && payloads.has(m[1]) && !hasFmtp.has(m[1])) result.push(`a=fmtp:${m[1]} ${extra}`)
  }
  return result.join('\r\n')
}

export function shortCodecName(mime: string): string {
  return mime.replace(/^video\//i, '').toUpperCase()
}
