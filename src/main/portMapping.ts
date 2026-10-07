import type { PortMappingStatus, VpnDetection } from '../shared/types'
import { isLocalIPv4, isPublicIPv4 } from '../shared/vpn'
import { getLocalAddresses } from '../utils/network'
import { fetchPublicAddress, PUBLIC_IP_URL } from '../utils/publicIp'
import { addPortMapping, deletePortMapping, discoverIgd, getExternalAddress, type DiscoverOptions, type Igd } from '../utils/upnp'
import type { Logger } from './server'

/** What opening the room's port came to. */
export interface PortMapping {
  status: PortMappingStatus
}

/** How guests' addresses are found and the router's port opened: the real thing, or a stand-in (see vpn/fake.ts). */
export interface VpnNetwork {
  detect(): Promise<VpnDetection>
  openPort(port: number): Promise<PortMapping>
  closePorts(): Promise<void>
}

const LEASE_SECONDS = 3600
const RENEW_MS = 20 * 60_000
const DESCRIPTION = 'ScreenShare VPN room'

/**
 * Finds out how this computer is reached from outside and, when the router allows it
 * (UPnP), opens the room's port for as long as the room lasts: the lease is short and
 * renewed, so a crash leaves nothing open for more than an hour.
 */
export class RouterNetwork implements VpnNetwork {
  private igd: Igd | null = null
  private opened: number[] = []
  private renewTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly log: Logger,
    private readonly options: { discover?: DiscoverOptions; publicIpUrl?: string } = {}
  ) {}

  async detect(): Promise<VpnDetection> {
    const localAddress = getLocalAddresses().find(isLocalIPv4) ?? null
    const [igd, outside] = await Promise.all([this.findRouter(), fetchPublicAddress(this.options.publicIpUrl ?? PUBLIC_IP_URL)])
    const router = igd ? await getExternalAddress(igd).catch(() => null) : null
    // The router's own address is the answer when no outside service could be asked.
    const publicAddress = outside ?? (isPublicIPv4(router) ? router : null)
    // The router says it is on the internet at one address, but the internet sees another (or a shared one).
    const behindCgnat = router ? !isPublicIPv4(router) || (outside !== null && outside !== router) : null
    return { localAddress, publicAddress, upnp: igd !== null, behindCgnat }
  }

  async openPort(port: number): Promise<PortMapping> {
    await this.closePorts()
    const igd = await this.findRouter()
    if (!igd) return { status: 'unavailable' }
    try {
      for (const protocol of ['TCP', 'UDP'] as const) await addPortMapping(igd, port, protocol, DESCRIPTION, LEASE_SECONDS)
    } catch (err) {
      this.log.warn(`the router would not open port ${port}: ${(err as Error).message}`)
      await Promise.all([deletePortMapping(igd, port, 'TCP'), deletePortMapping(igd, port, 'UDP')].map((p) => p.catch(() => undefined)))
      return { status: 'failed' }
    }
    this.opened.push(port)
    this.log.info(`opened port ${port} (TCP and UDP) on the router`)
    this.renewTimer = setInterval(() => void this.renew(), RENEW_MS)
    this.renewTimer.unref()
    return { status: 'opened' }
  }

  async closePorts(): Promise<void> {
    if (this.renewTimer) clearInterval(this.renewTimer)
    this.renewTimer = null
    const igd = this.igd
    const ports = this.opened.splice(0)
    if (!igd) return
    for (const port of ports) {
      for (const protocol of ['TCP', 'UDP'] as const) {
        await deletePortMapping(igd, port, protocol).catch((err) => this.log.warn(`could not close port ${port}: ${(err as Error).message}`))
      }
    }
    if (ports.length > 0) this.log.info('closed the room\'s ports on the router')
  }

  private async renew(): Promise<void> {
    const igd = this.igd
    if (!igd) return
    for (const port of this.opened) {
      for (const protocol of ['TCP', 'UDP'] as const) {
        await addPortMapping(igd, port, protocol, DESCRIPTION, LEASE_SECONDS).catch((err) =>
          this.log.warn(`could not renew port ${port}: ${(err as Error).message}`)
        )
      }
    }
  }

  private async findRouter(): Promise<Igd | null> {
    this.igd ??= await discoverIgd(this.options.discover)
    return this.igd
  }
}
