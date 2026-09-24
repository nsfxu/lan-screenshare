import { EventEmitter } from 'node:events'
import net from 'node:net'
import { Bonjour, type Browser, type Service } from 'bonjour-service'
import { MDNS_SERVICE_TYPE, PROTOCOL_VERSION } from '../shared/constants'
import { endpointKey } from './network'

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

/**
 * mDNS / DNS-SD wrapper: advertises the hosted room and browses for others.
 * Uses a pure-JS responder (bonjour-service), so no Bonjour/Avahi install is
 * required, but it coexists with them on the same machine.
 */
export class MdnsDiscovery extends EventEmitter<MdnsEvents> {
  private bonjour: Bonjour | null = null
  private browser: Browser | null = null
  private published: Service | null = null
  private requeryTimer: NodeJS.Timeout | null = null
  private readonly known = new Map<string, string>() // fqdn -> key

  start(): void {
    if (this.bonjour) return
    this.bonjour = new Bonjour({}, (err: unknown) => this.emit('error', toError(err)))
    this.browser = this.bonjour.find({ type: MDNS_SERVICE_TYPE, protocol: 'tcp' })
    this.browser.on('up', (s) => this.handleUp(s))
    this.browser.on('txt-update', (s) => this.handleUp(s))
    this.browser.on('srv-update', (s, old) => {
      this.handleDown(old)
      this.handleUp(s)
    })
    this.browser.on('down', (s) => this.handleDown(s))
    this.requeryTimer = setInterval(() => {
      try {
        this.browser?.expire()
        this.browser?.update()
      } catch (err) {
        this.emit('error', toError(err))
      }
    }, REQUERY_INTERVAL_MS)
  }

  /** Ask the network again right now (e.g. user pressed refresh). */
  refresh(): void {
    this.browser?.update()
  }

  publish(opts: { roomId: string; port: number; tls: boolean; fingerprint: string | null }): void {
    if (!this.bonjour) this.start()
    this.unpublish()
    this.published = this.bonjour!.publish({
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
    this.published.on('error', (err: unknown) => this.emit('error', toError(err)))
  }

  unpublish(): Promise<void> {
    const svc = this.published
    this.published = null
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

  async stop(): Promise<void> {
    if (this.requeryTimer) clearInterval(this.requeryTimer)
    this.requeryTimer = null
    await this.unpublish()
    this.browser?.stop()
    this.browser = null
    const bonjour = this.bonjour
    this.bonjour = null
    if (bonjour) await new Promise<void>((resolve) => bonjour.destroy(() => resolve()))
  }

  private handleUp(s: Service): void {
    const txt = (s.txt ?? {}) as Record<string, string>
    const address = pickAddress(s)
    if (!address || !s.port || !txt.id) return
    const key = endpointKey(address, s.port)
    const previous = this.known.get(s.fqdn)
    if (previous && previous !== key) this.emit('down', previous)
    this.known.set(s.fqdn, key)
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

  private handleDown(s: Service): void {
    const key = this.known.get(s.fqdn)
    if (!key) return
    this.known.delete(s.fqdn)
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
