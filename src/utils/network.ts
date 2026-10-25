import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import net from 'node:net'
import { createHash, X509Certificate } from 'node:crypto'
import type { TLSSocket } from 'node:tls'
import type { RoomEndpoint, RoomInfo } from '../shared/types'
import { isAvatar, isColor, isPictureHash } from '../shared/images'
import { toRoomPeople } from '../shared/people'
import { isAppVersion } from '../shared/version'

const VIRTUAL_ADAPTER = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|vbox|loopback|bridge|utun/i

/**
 * Non-internal IPv4 addresses of this machine (LAN + VPN adapters), most
 * useful first: private LAN ranges, then others, then virtual-machine
 * adapters, then link-local (169.254.x.x) addresses.
 */
export function getLocalAddresses(): string[] {
  const result: { address: string; rank: number }[] = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      result.push({ address: addr.address, rank: addressRank(name, addr.address) })
    }
  }
  return result.sort((a, b) => a.rank - b.rank).map((r) => r.address)
}

/**
 * IPv4 addresses mDNS should run on: one per interface that can carry multicast
 * (LAN, Wi-Fi and VPN adapters such as ZeroTier), without link-local ones.
 */
export function getMulticastAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const result: string[] = []
  for (const list of Object.values(interfaces)) {
    const addr = (list ?? []).find((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    if (addr) result.push(addr.address)
  }
  return result
}

export function addressRank(interfaceName: string, address: string): number {
  if (address.startsWith('169.254.')) return 4
  if (VIRTUAL_ADAPTER.test(interfaceName)) return 3
  if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) return 1
  return 2
}

/** Brackets IPv6 literals so they can be embedded in a URL. */
export function hostForUrl(address: string): string {
  return net.isIPv6(address) ? `[${address}]` : address
}

export function endpointKey(address: string, port: number): string {
  return `${address}:${port}`
}

export function endpointUrl(ep: Pick<RoomEndpoint, 'address' | 'port' | 'tls'>, path = '/', ws = false): string {
  const scheme = ws ? (ep.tls ? 'wss' : 'ws') : ep.tls ? 'https' : 'http'
  return `${scheme}://${hostForUrl(ep.address)}:${ep.port}${path}`
}

/**
 * Certificate fingerprint in the same format Electron reports in
 * `certificate-error` events: `sha256/<base64 of SHA-256(DER)>`.
 */
export function fingerprintFromDer(der: Buffer): string {
  return 'sha256/' + createHash('sha256').update(der).digest('base64')
}

export function fingerprintFromPem(pem: string): string {
  return fingerprintFromDer(new X509Certificate(pem).raw)
}

/** Parse `host`, `host:port`, `[v6]:port` into an address/port pair. */
export function parseHostPort(input: string, defaultPort: number): { address: string; port: number } | null {
  const text = input.trim()
  if (!text) return null
  let address = text
  let port = defaultPort
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(text)
  if (v6) {
    address = v6[1]
    if (v6[2]) port = Number(v6[2])
  } else if (!net.isIPv6(text)) {
    const idx = text.lastIndexOf(':')
    if (idx > 0) {
      address = text.slice(0, idx)
      port = Number(text.slice(idx + 1))
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!/^[A-Za-z0-9.\-:%]+$/.test(address)) return null
  return { address, port }
}

export interface ProbeResult {
  info: RoomInfo
  fingerprint: string | null
  ms: number
}

/**
 * Fetch GET /info from a room. With TLS the certificate is self-signed, so it
 * is not validated against a CA; instead the fingerprint is returned (and
 * compared against `expectedFingerprint` when one is known from mDNS).
 */
export async function probeRoom(
  ep: Pick<RoomEndpoint, 'address' | 'port' | 'tls'>,
  timeoutMs = 2500,
  expectedFingerprint?: string | null
): Promise<ProbeResult> {
  const started = Date.now()
  const { body, fingerprint } = await getJson(ep, '/info', timeoutMs, expectedFingerprint)
  const info = body as RoomInfo
  if (typeof info?.id !== 'string' || typeof info.name !== 'string') throw new Error('not a room')
  if (!isAppVersion(info.appVersion)) delete info.appVersion
  if (!isColor(info.hostColor)) delete info.hostColor
  if (!isPictureHash(info.hostPicture)) delete info.hostPicture
  const people = toRoomPeople(info.people)
  if (people) info.people = people
  else delete info.people
  return { info, fingerprint, ms: Date.now() - started }
}

/** The host's profile picture (GET /host-picture), checked like any picture from the network. */
export async function fetchHostPicture(
  ep: Pick<RoomEndpoint, 'address' | 'port' | 'tls'>,
  expectedFingerprint?: string | null
): Promise<string> {
  const { body } = await getJson(ep, '/host-picture', 2500, expectedFingerprint)
  const image = (body as { image?: unknown })?.image
  if (!isAvatar(image)) throw new Error('not a picture')
  return image
}

/** The picture of someone a room's /info lists (GET /picture), checked like any picture from the network. */
export async function fetchPicture(
  ep: Pick<RoomEndpoint, 'address' | 'port' | 'tls'>,
  hash: string,
  expectedFingerprint?: string | null
): Promise<string> {
  if (!isPictureHash(hash)) throw new Error('not a picture hash')
  const { body } = await getJson(ep, `/picture?hash=${hash}`, 2500, expectedFingerprint)
  const image = (body as { image?: unknown })?.image
  if (!isAvatar(image)) throw new Error('not a picture')
  return image
}

/** GET a small JSON document from a room (see probeRoom about its certificate). */
function getJson(
  ep: Pick<RoomEndpoint, 'address' | 'port' | 'tls'>,
  path: string,
  timeoutMs: number,
  expectedFingerprint?: string | null
): Promise<{ body: unknown; fingerprint: string | null }> {
  return new Promise((resolve, reject) => {
    const url = endpointUrl(ep, path)
    const options: https.RequestOptions = { timeout: timeoutMs, headers: { accept: 'application/json' } }
    if (ep.tls) {
      options.rejectUnauthorized = false
      options.checkServerIdentity = () => undefined
    }
    const req = (ep.tls ? https : http).get(url, options, (res) => {
      let fingerprint: string | null = null
      if (ep.tls) {
        const cert = (res.socket as TLSSocket).getPeerCertificate?.()
        fingerprint = cert?.raw ? fingerprintFromDer(cert.raw) : null
        if (expectedFingerprint && fingerprint !== expectedFingerprint) {
          res.resume()
          reject(new Error('certificate fingerprint mismatch'))
          return
        }
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        body += chunk
        if (body.length > 64 * 1024) req.destroy(new Error('response too large'))
      })
      res.on('end', () => {
        try {
          resolve({ body: JSON.parse(body) as unknown, fingerprint })
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}
