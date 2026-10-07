import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { MAX_USERS, VPN_KEEPALIVE_SECONDS, VPN_PREFIX_LENGTH } from '../../shared/constants'
import type { VpnAvailability, VpnDetection, VpnInvite, VpnStatus } from '../../shared/types'
import { decodeInvite, networkOf, overlapsNetwork, parseEnrollResponse, pickNetwork } from '../../shared/vpn'
import { getLocalAddresses, hostForUrl, postJson } from '../../utils/network'
import { generateKeyPair } from '../../utils/wireguard'
import type { Logger } from '../server'
import { VpnHost } from './host'
import { RouterNetwork, type PortMapping, type VpnNetwork } from '../portMapping'
import { SystemTunnel, type VpnTunnel } from './tunnel'

/** What the manager needs from the computer; tests and the end-to-end suite swap it for a fake. */
export interface VpnEnvironment {
  /** The host's address as guests would see it, and the router's port. */
  network: VpnNetwork
  availability(): Promise<VpnAvailability>
  createTunnel(): VpnTunnel
  localAddresses(): string[]
  /**
   * Where a guest finds the room once enrolled: the host's address inside the
   * VPN, or (fake tunnels, which carry no traffic) the address from the invite.
   */
  roomAddress(invite: VpnInvite): string
}

/**
 * The computer's real VPN support: the helper bundled with the app (see helper.ts)
 * and, on Linux, polkit to ask for the administrator password.
 */
export function systemVpnEnvironment(helperPath: string | null, checksums: Record<string, string> | null, log: Logger): VpnEnvironment {
  const platform = process.platform
  return {
    network: new RouterNetwork(log),
    async availability() {
      if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
        return { ok: false, reason: 'Remote rooms are not available on this system.' }
      }
      if (!helperPath) {
        return {
          ok: false,
          reason: 'This build of ScreenShare has no Remote helper. Install the official release, or build it with: npm run build:vpn (needs Go).'
        }
      }
      if (platform === 'linux' && !onPath('pkexec')) {
        return { ok: false, reason: 'Remote rooms need polkit to ask for your administrator password (install the "polkit" package).' }
      }
      return { ok: true, reason: null }
    },
    createTunnel() {
      if (!helperPath) throw new Error('Remote rooms are not available here')
      return new SystemTunnel(platform, helperPath, checksums)
    },
    localAddresses: getLocalAddresses,
    roomAddress: (invite) => invite.hostAddress
  }
}

function onPath(program: string): boolean {
  return (process.env.PATH ?? '').split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, program)))
}

export interface VpnManagerEvents {
  status: [status: VpnStatus]
}

/**
 * One VPN at a time: either this app hosts a VPN room, or it joined someone
 * else's. The tunnel lives until the host closes the room, the guest
 * disconnects, or the app quits.
 */
export class VpnManager extends EventEmitter<VpnManagerEvents> {
  private tunnel: VpnTunnel | null = null
  private host: VpnHost | null = null
  private current: VpnStatus = OFF

  constructor(
    private readonly env: VpnEnvironment,
    private readonly log: Logger
  ) {
    super()
  }

  status(): VpnStatus {
    return { ...this.current, peers: this.host?.peers ?? 0 }
  }

  detect(): Promise<VpnDetection> {
    return this.env.network.detect()
  }

  openPort(port: number): Promise<PortMapping> {
    return this.env.network.openPort(port)
  }

  availability(): Promise<VpnAvailability> {
    return this.env.availability()
  }

  /** The room server hands guests' enrolment requests to the result's `enroll`. */
  async createHost(): Promise<VpnHost> {
    await this.assertFree()
    const tunnel = this.env.createTunnel()
    const network = pickNetwork(this.env.localAddresses())
    const host = new VpnHost(tunnel, network, this.log, () => this.emitStatus(), MAX_USERS - 1)
    this.tunnel = tunnel
    this.host = host
    return host
  }

  /** Called once the room server is listening and the tunnel is up. */
  hostReady(iface: string): void {
    if (!this.host) return
    this.current = { mode: 'hosting', address: this.host.address, interface: iface, peers: 0 }
    this.emitStatus()
  }

  async stopHost(): Promise<void> {
    const host = this.host
    if (!host) return
    this.host = this.tunnel = null
    this.current = OFF
    await this.env.network.closePorts()
    await host.stop()
    this.emitStatus()
  }

  /**
   * Enrols with the host the invite came from and brings the tunnel up.
   * Returns the address to join the room at.
   */
  async join(
    inviteText: string,
    /** This install's id (settings.clientId): joining the same room again reuses the same address. */
    clientId: string
  ): Promise<{ address: string; port: number; tls: boolean; fingerprint: string | null }> {
    const invite = decodeInvite(inviteText)
    if (!invite) throw new Error('That is not a ScreenShare Remote invite. Paste the whole line the host sent you.')
    await this.assertFree()
    if (overlapsNetwork(networkOf(invite.hostAddress), this.env.localAddresses())) {
      throw new Error(`Your network already uses ${networkOf(invite.hostAddress)}.x, the same range as this Remote room. Ask the host to reopen the room.`)
    }

    const keys = generateKeyPair()
    let answer
    try {
      answer = await postJson(
        { address: invite.endpoint, port: invite.port, tls: invite.tls },
        '/vpn/enroll',
        { secret: invite.secret, publicKey: keys.publicKey, clientId },
        invite.fingerprint
      )
    } catch (err) {
      throw new Error(`Could not reach the host at ${invite.endpoint}:${invite.port}: ${(err as Error).message}`)
    }
    if (answer.status !== 200) throw new Error(enrollError(answer.status, answer.body))
    const enrolled = parseEnrollResponse(answer.body, invite)
    if (!enrolled) throw new Error('The host sent an answer that does not match its invite')

    const tunnel = this.env.createTunnel()
    this.tunnel = tunnel
    try {
      const { interface: iface } = await tunnel.up({
        address: enrolled.address,
        prefix: VPN_PREFIX_LENGTH,
        privateKey: keys.privateKey,
        peers: [
          {
            publicKey: invite.hostKey,
            endpoint: `${hostForUrl(invite.endpoint)}:${invite.port}`,
            // The whole network, so other guests are reached through the host.
            allowedIps: [`${networkOf(invite.hostAddress)}.0/${VPN_PREFIX_LENGTH}`],
            keepalive: VPN_KEEPALIVE_SECONDS
          }
        ],
        forward: false
      })
      this.current = { mode: 'joined', address: enrolled.address, interface: iface, peers: 0 }
    } catch (err) {
      this.tunnel = null
      throw err
    }
    this.log.info(`joined a VPN room as ${enrolled.address}`)
    this.emitStatus()
    return { address: this.env.roomAddress(invite), port: invite.port, tls: invite.tls, fingerprint: invite.fingerprint }
  }

  /** Disconnects a joined VPN (a hosted one ends with its room). */
  async leave(): Promise<void> {
    if (this.current.mode !== 'joined') return
    const tunnel = this.tunnel
    this.tunnel = null
    this.current = OFF
    await tunnel?.down()
    this.emitStatus()
  }

  async stop(): Promise<void> {
    await this.stopHost()
    await this.leave()
  }

  private async assertFree(): Promise<void> {
    if (this.tunnel) {
      throw new Error(this.host ? 'You are already hosting a Remote room' : 'You are already connected to a Remote room. Disconnect it first.')
    }
    const availability = await this.env.availability()
    if (!availability.ok) throw new Error(availability.reason ?? 'Remote rooms are not available here')
  }

  private emitStatus(): void {
    this.emit('status', this.status())
  }
}

const OFF: VpnStatus = { mode: 'off', address: null, interface: null, peers: 0 }

function enrollError(status: number, body: unknown): string {
  const error = (body as { error?: string } | null)?.error
  if (status === 401) return 'The host did not accept this invite. Ask for a new one.'
  if (status === 429) return 'Too many wrong tries. Wait a few minutes and try again.'
  if (status === 409) return 'The Remote room is full.'
  if (status === 503) return 'The host is still starting the Remote room. Try again in a moment.'
  return `The host refused the invite (${error ?? status})`
}
