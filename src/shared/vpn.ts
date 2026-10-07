import { VPN_NETWORK_PREFIX, VPN_PREFIX_LENGTH } from './constants'
import type { VpnEnrollRequest, VpnEnrollResponse, VpnInvite } from './types'

/** A WireGuard key as `wg` prints it: 32 bytes in base64 (44 characters). */
export function isWireGuardKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value)
}

/** WireGuard's userspace protocol wants keys in hex. */
export function keyToHex(key: string): string {
  return [...atob(key)].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): string {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

export function isIPv4(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parts = value.split('.')
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && String(Number(p)) === p)
}

/** `10.77.5.1` -> `10.77.5` (the first three bytes of a /24). */
export function networkOf(address: string): string {
  return address.split('.').slice(0, 3).join('.')
}

export function hostAddressOf(network: string): string {
  return `${network}.1`
}

/**
 * Picks a network for a new VPN room: 10.77.N.0/24, avoiding the networks this
 * computer is already on (a clash would send the VPN's traffic to the wrong place).
 * `random` returns a number in [0, 1).
 */
export function pickNetwork(localAddresses: string[], random: () => number = Math.random): string {
  const taken = new Set(localAddresses.filter(isIPv4).map(networkOf))
  const free: number[] = []
  for (let n = 1; n < 255; n++) if (!taken.has(`${VPN_NETWORK_PREFIX}.${n}`)) free.push(n)
  if (free.length === 0) throw new Error('No free VPN network')
  return `${VPN_NETWORK_PREFIX}.${free[Math.floor(random() * free.length)]}`
}

/** True when any of these addresses is inside the network (a /24 given as `a.b.c`). */
export function overlapsNetwork(network: string, localAddresses: string[]): boolean {
  return localAddresses.some((a) => isIPv4(a) && networkOf(a) === network)
}

/**
 * Hands out the guests' addresses (.2 to .254) and remembers who got which, so
 * the same guest asking again gets the same address.
 */
export class AddressPool {
  private readonly byClient = new Map<string, number>()

  constructor(
    private readonly network: string,
    private readonly capacity = 253
  ) {}

  get size(): number {
    return this.byClient.size
  }

  /** The guest's address, or null when the pool is full. */
  assign(clientId: string): string | null {
    let host = this.byClient.get(clientId)
    if (host === undefined) {
      const used = new Set(this.byClient.values())
      for (let n = 2; n < 2 + this.capacity; n++) {
        if (!used.has(n)) {
          host = n
          break
        }
      }
      if (host === undefined) return null
      this.byClient.set(clientId, host)
    }
    return `${this.network}.${host}`
  }

  release(clientId: string): void {
    this.byClient.delete(clientId)
  }
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

const INVITE_PREFIX = 'ssvpn1.'

/** The invite is one line to paste into a chat: `ssvpn1.` + base64url of the JSON. */
export function encodeInvite(invite: VpnInvite): string {
  return INVITE_PREFIX + toBase64Url(JSON.stringify(invite))
}

/** Parses and validates an invite; null when it is not one of ours or is malformed. */
export function decodeInvite(text: string): VpnInvite | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(INVITE_PREFIX) || trimmed.length > 2048) return null
  let raw: unknown
  try {
    raw = JSON.parse(fromBase64Url(trimmed.slice(INVITE_PREFIX.length)))
  } catch {
    return null
  }
  const v = raw as Partial<VpnInvite> | null
  if (!v || typeof v !== 'object') return null
  if (typeof v.endpoint !== 'string' || !isValidEndpointHost(v.endpoint)) return null
  if (!Number.isInteger(v.port) || v.port! < 1 || v.port! > 65535) return null
  if (typeof v.tls !== 'boolean') return null
  if (v.fingerprint !== null && !(typeof v.fingerprint === 'string' && /^sha256\/[A-Za-z0-9+/]{43}=$/.test(v.fingerprint))) return null
  if (v.tls && !v.fingerprint) return null
  if (!isWireGuardKey(v.hostKey) || !isIPv4(v.hostAddress)) return null
  if (typeof v.secret !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(v.secret)) return null
  return {
    endpoint: v.endpoint,
    port: v.port!,
    tls: v.tls,
    fingerprint: v.fingerprint ?? null,
    hostKey: v.hostKey,
    hostAddress: v.hostAddress,
    secret: v.secret
  }
}

/** A host name or IP (no port, no brackets), as accepted in the "address guests use" field. */
export function isValidEndpointHost(host: string): boolean {
  return host.length > 0 && host.length <= 253 && /^[A-Za-z0-9.\-:]+$/.test(host)
}

// ---------------------------------------------------------------------------
// Enrolment messages (POST /vpn/enroll)
// ---------------------------------------------------------------------------

/** Validates the body of an enrolment request; null when anything is off. */
export function parseEnrollRequest(raw: unknown): VpnEnrollRequest | null {
  const v = raw as Partial<VpnEnrollRequest> | null
  if (!v || typeof v !== 'object') return null
  if (typeof v.secret !== 'string' || v.secret.length === 0 || v.secret.length > 128) return null
  if (!isWireGuardKey(v.publicKey)) return null
  if (typeof v.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v.clientId)) return null
  return { secret: v.secret, publicKey: v.publicKey, clientId: v.clientId }
}

/** Validates the host's answer on the guest's side, so a bogus host can't make us configure nonsense. */
export function parseEnrollResponse(raw: unknown, invite: VpnInvite): VpnEnrollResponse | null {
  const v = raw as Partial<VpnEnrollResponse> | null
  if (!v || typeof v !== 'object') return null
  if (!isIPv4(v.address) || !isIPv4(v.hostAddress)) return null
  if (v.prefix !== VPN_PREFIX_LENGTH) return null
  if (v.hostAddress !== invite.hostAddress || v.hostKey !== invite.hostKey) return null
  if (networkOf(v.address) !== networkOf(invite.hostAddress) || v.address === v.hostAddress) return null
  if (v.port !== invite.port) return null
  return { address: v.address, hostAddress: v.hostAddress, prefix: v.prefix, hostKey: v.hostKey, port: v.port }
}
