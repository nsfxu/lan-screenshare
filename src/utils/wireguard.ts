import { generateKeyPairSync } from 'node:crypto'
import net from 'node:net'
import { keyToHex } from '../shared/vpn'

export interface WireGuardKeyPair {
  /** Base64, as `wg genkey` prints it. Memory only: never write it anywhere. */
  privateKey: string
  publicKey: string
}

/** A fresh X25519 key pair in WireGuard's format (raw 32-byte keys, base64). */
export function generateKeyPair(): WireGuardKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  return { privateKey: rawKey(privateKey.export({ format: 'jwk' }).d), publicKey: rawKey(publicKey.export({ format: 'jwk' }).x) }
}

function rawKey(base64url: string | undefined): string {
  if (!base64url) throw new Error('could not export the key')
  return Buffer.from(base64url, 'base64url').toString('base64')
}

// ---------------------------------------------------------------------------
// UAPI: the text protocol wireguard-go serves on /var/run/wireguard/<name>.sock
// ---------------------------------------------------------------------------

export interface UapiPeer {
  publicKey: string
  allowedIps: string[]
  /** `host:port`, for a peer that we dial; a peer that dials us needs none. */
  endpoint?: string
  keepalive?: number
}

export interface UapiDevice {
  privateKey: string
  listenPort?: number
}

/** The `set=1` request that configures the device (and drops any other peer). */
export function uapiSetDevice(device: UapiDevice, peers: UapiPeer[]): string {
  const lines = ['set=1', `private_key=${keyToHex(device.privateKey)}`]
  if (device.listenPort !== undefined) lines.push(`listen_port=${device.listenPort}`)
  lines.push('replace_peers=true')
  for (const peer of peers) lines.push(...peerLines(peer))
  return lines.join('\n') + '\n\n'
}

export function uapiSetPeer(peer: UapiPeer): string {
  return ['set=1', ...peerLines(peer)].join('\n') + '\n\n'
}

export function uapiRemovePeer(publicKey: string): string {
  return `set=1\npublic_key=${keyToHex(publicKey)}\nremove=true\n\n`
}

function peerLines(peer: UapiPeer): string[] {
  const lines = [`public_key=${keyToHex(peer.publicKey)}`, 'replace_allowed_ips=true']
  if (peer.endpoint) lines.push(`endpoint=${peer.endpoint}`)
  if (peer.keepalive) lines.push(`persistent_keepalive_interval=${peer.keepalive}`)
  for (const ip of peer.allowedIps) lines.push(`allowed_ip=${ip}`)
  return lines
}

/** Sends one request to a wireguard-go socket and resolves when it answers `errno=0`. */
export function uapiRequest(socketPath: string, request: string, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath)
    let answer = ''
    const fail = (err: Error): void => {
      socket.destroy()
      reject(err)
    }
    socket.setTimeout(timeoutMs, () => fail(new Error('wireguard did not answer')))
    socket.setEncoding('utf8')
    socket.on('error', fail)
    socket.on('connect', () => socket.write(request))
    socket.on('data', (chunk: string) => {
      answer += chunk
      if (!answer.endsWith('\n\n')) return
      socket.end()
      const errno = /^errno=(-?\d+)$/m.exec(answer)
      if (errno && errno[1] !== '0') reject(new Error(`wireguard refused the configuration (errno ${errno[1]})`))
      else resolve(answer)
    })
  })
}
