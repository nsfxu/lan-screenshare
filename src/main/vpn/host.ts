import { VPN_KEEPALIVE_SECONDS, VPN_PREFIX_LENGTH } from '../../shared/constants'
import type { VpnEnrollResponse } from '../../shared/types'
import { AddressPool, encodeInvite, hostAddressOf, parseEnrollRequest } from '../../shared/vpn'
import { PinGuard, randomToken } from '../../utils/crypto'
import { generateKeyPair, type WireGuardKeyPair } from '../../utils/wireguard'
import type { Logger } from '../server'
import type { VpnTunnel } from './tunnel'

export interface VpnHostInfo {
  /** Host name or IP guests reach this computer at, from outside the VPN. */
  endpoint: string
  /** The room server's port: TCP for enrolment and the room, UDP for the tunnel. */
  port: number
  tls: boolean
  fingerprint: string | null
}

export interface EnrollResult {
  status: number
  body: unknown
}

const SECRET_FORMAT = /^[A-Za-z0-9_-]{16,64}$/

/**
 * The host's side of a VPN room: owns the tunnel, the invite secret and the
 * guests' addresses. The room server hands it `POST /vpn/enroll` requests.
 */
export class VpnHost {
  private readonly keys: WireGuardKeyPair = generateKeyPair()
  private readonly secret = randomToken(24)
  private readonly pool: AddressPool
  private readonly guard = new PinGuard()
  /** clientId -> the WireGuard key it enrolled with. */
  private readonly keysByClient = new Map<string, string>()
  private info: VpnHostInfo | null = null
  private ready = false
  private queue: Promise<unknown> = Promise.resolve()
  readonly address: string

  constructor(
    private readonly tunnel: VpnTunnel,
    private readonly network: string,
    private readonly log: Logger,
    private readonly onChange: () => void,
    private readonly maxGuests: number
  ) {
    this.pool = new AddressPool(network, maxGuests)
    this.address = hostAddressOf(network)
  }

  get peers(): number {
    return this.pool.size
  }

  /** Brings the tunnel up and returns the invite for guests. */
  async start(info: VpnHostInfo): Promise<{ invite: string; interface: string }> {
    this.info = info
    const { interface: iface } = await this.tunnel.up({
      address: this.address,
      prefix: VPN_PREFIX_LENGTH,
      privateKey: this.keys.privateKey,
      listenPort: info.port,
      peers: [],
      forward: true
    })
    this.ready = true
    this.log.info(`VPN room up on ${iface} (${this.network}.0/${VPN_PREFIX_LENGTH})`)
    return {
      invite: encodeInvite({
        endpoint: info.endpoint,
        port: info.port,
        tls: info.tls,
        fingerprint: info.fingerprint,
        hostKey: this.keys.publicKey,
        hostAddress: this.address,
        secret: this.secret
      }),
      interface: iface
    }
  }

  async stop(): Promise<void> {
    this.ready = false
    await this.tunnel.down()
  }

  /** One enrolment at a time, so two guests can never be handed the same address. */
  enroll(body: unknown, remoteIp: string): Promise<EnrollResult> {
    const run = this.queue.then(() => this.enrollNow(body, remoteIp))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async enrollNow(body: unknown, remoteIp: string): Promise<EnrollResult> {
    if (!this.ready || !this.info) return { status: 503, body: { error: 'not_ready' } }
    const req = parseEnrollRequest(body)
    if (!req) return { status: 400, body: { error: 'bad_request' } }

    const check = this.guard.check(remoteIp, this.secret, req.secret, (v) => SECRET_FORMAT.test(v))
    if (check.locked) return { status: 429, body: { error: 'locked', retryAfterMs: check.retryAfterMs } }
    if (!check.ok) return { status: 401, body: { error: 'bad_secret', attemptsLeft: check.attemptsLeft } }

    const known = this.keysByClient.get(req.clientId)
    const keyTaken = [...this.keysByClient].some(([id, key]) => key === req.publicKey && id !== req.clientId)
    if (keyTaken || req.publicKey === this.keys.publicKey) return { status: 400, body: { error: 'bad_request' } }

    const address = this.pool.assign(req.clientId)
    if (!address) return { status: 409, body: { error: 'full' } }
    try {
      if (known && known !== req.publicKey) await this.tunnel.removePeer(known)
      await this.tunnel.setPeer({ publicKey: req.publicKey, allowedIps: [`${address}/32`], keepalive: VPN_KEEPALIVE_SECONDS })
    } catch (err) {
      if (!known) this.pool.release(req.clientId)
      this.log.warn('could not add a VPN guest', err)
      return { status: 500, body: { error: 'tunnel' } }
    }
    this.keysByClient.set(req.clientId, req.publicKey)
    this.log.info(`VPN guest enrolled as ${address}`)
    this.onChange()
    const response: VpnEnrollResponse = {
      address,
      hostAddress: this.address,
      prefix: VPN_PREFIX_LENGTH,
      hostKey: this.keys.publicKey,
      port: this.info.port
    }
    return { status: 200, body: response }
  }
}
