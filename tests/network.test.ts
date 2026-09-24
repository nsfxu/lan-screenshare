import { describe, expect, it } from 'vitest'
import { generate } from 'selfsigned'
import { createHash, X509Certificate } from 'node:crypto'
import { RoomServer } from '../src/main/server'
import { addressRank, endpointUrl, fingerprintFromPem, parseHostPort, probeRoom } from '../src/utils/network'
import { chooseCodecOrder, mungeBitrates, mungeOpus } from '../src/shared/codecs'

describe('parseHostPort', () => {
  it('parses addresses with and without ports', () => {
    expect(parseHostPort('192.168.1.20', 47800)).toEqual({ address: '192.168.1.20', port: 47800 })
    expect(parseHostPort(' 10.8.0.5:5000 ', 47800)).toEqual({ address: '10.8.0.5', port: 5000 })
    expect(parseHostPort('myhost.local', 47800)).toEqual({ address: 'myhost.local', port: 47800 })
    expect(parseHostPort('[fe80::1]:9000', 1)).toEqual({ address: 'fe80::1', port: 9000 })
    expect(parseHostPort('fe80::1', 1)).toEqual({ address: 'fe80::1', port: 1 })
  })

  it('rejects junk', () => {
    expect(parseHostPort('', 1)).toBeNull()
    expect(parseHostPort('host:99999', 1)).toBeNull()
    expect(parseHostPort('bad host', 1)).toBeNull()
    expect(parseHostPort('evil/path', 1)).toBeNull()
  })

  it('ranks LAN addresses above virtual and link-local adapters', () => {
    expect(addressRank('Ethernet', '192.168.1.20')).toBeLessThan(addressRank('Tailscale', '100.64.0.5'))
    expect(addressRank('Tailscale', '100.64.0.5')).toBeLessThan(addressRank('vEthernet (WSL)', '172.30.176.1'))
    expect(addressRank('vEthernet (WSL)', '172.30.176.1')).toBeLessThan(addressRank('Ethernet 2', '169.254.83.107'))
  })

  it('builds URLs with bracketed IPv6', () => {
    expect(endpointUrl({ address: 'fe80::1', port: 5, tls: true }, '/ws', true)).toBe('wss://[fe80::1]:5/ws')
    expect(endpointUrl({ address: '10.0.0.1', port: 5, tls: false }, '/info')).toBe('http://10.0.0.1:5/info')
  })
})

describe('TLS rooms', () => {
  it('probes a TLS room and returns the pinned certificate fingerprint', async () => {
    const pems = await generate([{ name: 'commonName', value: 'test' }], { keyType: 'ec', algorithm: 'sha256' })
    const server = new RoomServer({
      roomId: 'tls1',
      name: 'Secure',
      hostName: 'Host',
      privacy: 'public',
      pin: null,
      hostToken: 't',
      tls: { key: pems.private, cert: pems.cert },
      port: 0,
      bindAddress: '127.0.0.1'
    })
    const port = await server.start()
    try {
      const fp = fingerprintFromPem(pems.cert)
      expect(fp).toBe('sha256/' + createHash('sha256').update(new X509Certificate(pems.cert).raw).digest('base64'))

      const result = await probeRoom({ address: '127.0.0.1', port, tls: true })
      expect(result.info.name).toBe('Secure')
      expect(result.fingerprint).toBe(fp)

      await expect(probeRoom({ address: '127.0.0.1', port, tls: true }, 2000, 'sha256/wrong')).rejects.toThrow(/mismatch/)
    } finally {
      await server.stop()
    }
  })
})

describe('codec selection', () => {
  const enc = (mime: string, hardware: boolean) => ({ mimeType: mime, hardware })

  it('prefers hardware H.264 in auto mode', () => {
    const order = chooseCodecOrder(
      'auto',
      [enc('video/H264', true), enc('video/H265', true), enc('video/VP8', false)],
      [enc('video/H264', true), enc('video/H265', true), enc('video/VP8', false)]
    )
    expect(order[0]).toBe('video/H264')
    expect(order).toContain('video/H265')
  })

  it('picks H.265 when only it is hardware accelerated on both ends', () => {
    const order = chooseCodecOrder(
      'auto',
      [enc('video/H264', false), enc('video/H265', true), enc('video/VP8', false)],
      [enc('video/H264', false), enc('video/H265', true), enc('video/VP8', false)]
    )
    expect(order[0]).toBe('video/H265')
  })

  it('never offers a codec the viewer cannot decode and honours explicit choices', () => {
    const order = chooseCodecOrder('h265', [enc('video/H264', true), enc('video/H265', true)], [enc('video/H264', false)])
    expect(order).toEqual(['video/H264'])
    expect(chooseCodecOrder('vp9', [enc('video/H264', true), enc('video/VP9', false)], [])[0]).toBe('video/VP9')
  })

  it('configures Opus for stereo, high-bitrate system audio', () => {
    const sdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1',
      'a=rtpmap:63 red/48000/2',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'a=rtpmap:96 VP8/90000',
      ''
    ].join('\r\n')
    const out = mungeOpus(sdp).split('\r\n')
    const fmtp = out.find((l) => l.startsWith('a=fmtp:111 '))!
    expect(fmtp).toContain('minptime=10')
    expect(fmtp).toContain('stereo=1')
    expect(fmtp).toContain('maxaveragebitrate=128000')
    expect(fmtp).toContain('usedtx=0')
    expect(fmtp.match(/usedtx/g)).toHaveLength(1)
    expect(out.filter((l) => l.startsWith('a=fmtp:'))).toHaveLength(1)
    // No audio section: unchanged.
    const videoOnly = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n'
    expect(mungeOpus(videoOnly)).toBe(videoOnly)
  })

  it('adds start/min bitrate hints to video codecs only', () => {
    const sdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10',
      'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98',
      'a=rtpmap:96 VP8/90000',
      'a=rtpmap:97 rtx/90000',
      'a=fmtp:97 apt=96',
      'a=rtpmap:98 H264/90000',
      'a=fmtp:98 packetization-mode=1;profile-level-id=42e01f',
      ''
    ].join('\r\n')
    const out = mungeBitrates(sdp, 6000, 300).split('\r\n')
    expect(out).toContain('a=fmtp:111 minptime=10')
    expect(out).toContain('a=fmtp:97 apt=96')
    expect(out).toContain('a=fmtp:96 x-google-start-bitrate=6000;x-google-min-bitrate=300')
    expect(out).toContain('a=fmtp:98 packetization-mode=1;profile-level-id=42e01f;x-google-start-bitrate=6000;x-google-min-bitrate=300')
  })
})
