import { EventEmitter } from 'node:events'
import net from 'node:net'
import { Bonjour, type Browser, type Service } from 'bonjour-service'
import { MDNS_SERVICE_TYPE, PROTOCOL_VERSION } from '../shared/constants'
import { endpointKey, getMulticastAddresses } from './network'

/** What a room advertises in its TXT record. Live data comes from GET /info. */
export interface MdnsRoomRecord {
  key: string
  roomId: string
  address: string
  port: number
  tls: boolean
  fingerprint: string | null
  protocol: number
}

export interface MdnsEvents {
  up: [record: MdnsRoomRecord]
  down: [key: string]
  error: [error: Error]
}

const REQUERY_INTERVAL_MS = 5_000

interface PublishOptions {
  roomId: string
  port: number
  tls: boolean
  fingerprint: string | null
}

/** One responder bound to one network interface (LAN, Wi-Fi, ZeroTier...). */
interface Responder {
  address: string
  bonjour: Bonjour
  browser: Browser
  published: Service | null
  known: Map<string, string> // fqdn -> key
}

/**
 * mDNS / DNS-SD wrapper: advertises the hosted room and browses for others.
 * Uses a pure-JS responder (bonjour-service), so no Bonjour/Avahi install is
 * required, but it coexists with them on the same machine.
 *
 * It runs one responder per IPv4 interface. A single socket sends multicast
 * out of one interface only (the OS's pick, usually the physical LAN), so a
 * room would never reach a VPN such as ZeroTier, which does carry multicast.
 * The set of interfaces is re-checked on every requery, so a VPN that comes
 * up later is picked up too.
 */
export class MdnsDiscovery extends EventEmitter<MdnsEvents> {
  private responders = new Map<string, Responder>() // interface address -> responder
  private running = false
  private advert: PublishOptions | null = null
  private requeryTimer: NodeJS.Timeout | null = null

  start(): void {
    if (this.running) return
    this.running = true
    this.sync()
    this.requeryTimer = setInterval(() => {
      this.sync()
      for (const r of this.responders.values()) {
        try {
          r.browser.expire()
          r.browser.update()
        } catch (err) {
          this.emit('error', toError(err))
        }
      }
    }, REQUERY_INTERVAL_MS)
  }

  /** Ask the network again right now (e.g. user pressed refresh). */
  refresh(): void {
    this.sync()
    for (const r of this.responders.values()) r.browser.update()
  }

  publish(opts: PublishOptions): void {
    this.start()
    this.advert = opts
    for (const r of this.responders.values()) this.publishOn(r)
  }

  unpublish(): Promise<void> {
    this.advert = null
    return Promise.all([...this.responders.values()].map((r) => this.unpublishOn(r))).then(() => undefined)
  }

  async stop(): Promise<void> {
    if (this.requeryTimer) clearInterval(this.requeryTimer)
    this.requeryTimer = null
    this.running = false
    this.advert = null
    const all = [...this.responders.values()]
    this.responders.clear()
    await Promise.all(all.map((r) => this.destroy(r)))
  }

  /** Start responders for new interfaces and stop the ones whose interface is gone. */
  private sync(): void {
    if (!this.running) return
    const wanted = new Set(getMulticastAddresses())
    for (const [address, r] of this.responders) {
      if (wanted.has(address)) continue
      this.responders.delete(address)
      for (const key of r.known.values()) this.emit('down', key)
      void this.destroy(r)
    }
    for (const address of wanted) {
      if (this.responders.has(address)) continue
      try {
        const r = this.open(address)
        this.responders.set(address, r)
        if (this.advert) this.publishOn(r)
      } catch (err) {
        this.emit('error', toError(err))
      }
    }
  }

  private open(address: string): Responder {
    // bind to every address so multicast is received, but send and join on this interface only.
    // The options go straight to multicast-dns; bonjour-service's types don't list them.
    const options = { interface: address, bind: '0.0.0.0' } as ConstructorParameters<typeof Bonjour>[0]
    const bonjour = new Bonjour(options, (err: unknown) => this.emit('error', toError(err)))
    const browser = bonjour.find({ type: MDNS_SERVICE_TYPE, protocol: 'tcp' })
    const r: Responder = { address, bonjour, browser, published: null, known: new Map() }
    browser.on('up', (s) => this.handleUp(r, s))
    browser.on('txt-update', (s) => this.handleUp(r, s))
    browser.on('srv-update', (s, old) => {
      this.handleDown(r, old)
      this.handleUp(r, s)
    })
    browser.on('down', (s) => this.handleDown(r, s))
    return r
  }

  private publishOn(r: Responder): void {
    const opts = this.advert
    if (!opts) return
    void this.unpublishOn(r)
    r.published = r.bonjour.publish({
      name: `ScreenShare-${opts.roomId}`,
      type: MDNS_SERVICE_TYPE,
      protocol: 'tcp',
      port: opts.port,
      probe: false,
      disableIPv6: true,
      txt: {
        id: opts.roomId,
        v: String(PROTOCOL_VERSION),
        tls: opts.tls ? '1' : '0',
        fp: opts.fingerprint ?? ''
      }
    })
    r.published.on('error', (err: unknown) => this.emit('error', toError(err)))
  }

  private unpublishOn(r: Responder): Promise<void> {
    const svc = r.published
    r.published = null
    if (!svc) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000)
      try {
        svc.stop?.(() => {
          clearTimeout(timer)
          resolve()
        })
      } catch {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  private async destroy(r: Responder): Promise<void> {
    await this.unpublishOn(r)
    try {
      r.browser.stop()
      await new Promise<void>((resolve) => r.bonjour.destroy(() => resolve()))
    } catch (err) {
      this.emit('error', toError(err))
    }
  }

  private handleUp(r: Responder, s: Service): void {
    const txt = (s.txt ?? {}) as Record<string, string>
    const address = pickAddress(s)
    if (!address || !s.port || !txt.id) return
    const key = endpointKey(address, s.port)
    const previous = r.known.get(s.fqdn)
    if (previous && previous !== key) this.emit('down', previous)
    r.known.set(s.fqdn, key)
    this.emit('up', {
      key,
      roomId: String(txt.id),
      address,
      port: s.port,
      tls: txt.tls === '1',
      fingerprint: txt.fp ? String(txt.fp) : null,
      protocol: Number(txt.v) || 0
    })
  }

  private handleDown(r: Responder, s: Service): void {
    const key = r.known.get(s.fqdn)
    if (!key) return
    r.known.delete(s.fqdn)
    this.emit('down', key)
  }
}

/** Prefer the IPv4 address the answer actually came from, then any IPv4. */
function pickAddress(s: Service): string | null {
  const addresses = (s.addresses ?? []).filter((a) => net.isIPv4(a))
  const referer = s.referer?.address
  if (referer && addresses.includes(referer)) return referer
  if (addresses.length > 0) return addresses[0]
  return referer && net.isIPv4(referer) ? referer : null
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}
