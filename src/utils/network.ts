import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import net from 'node:net'
import { createHash, X509Certificate } from 'node:crypto'
import type { TLSSocket } from 'node:tls'
import type { RoomEndpoint, RoomInfo } from '../shared/types'

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
export function probeRoom(
  ep: Pick<RoomEndpoint, 'address' | 'port' | 'tls'>,
  timeoutMs = 2500,
  expectedFingerprint?: string | null
): Promise<ProbeResult> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const url = endpointUrl(ep, '/info')
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
          const info = JSON.parse(body) as RoomInfo
          if (typeof info?.id !== 'string' || typeof info.name !== 'string') throw new Error('not a room')
          resolve({ info, fingerprint, ms: Date.now() - started })
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}
