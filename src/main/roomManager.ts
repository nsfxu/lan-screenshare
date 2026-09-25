import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generate as generateCert } from 'selfsigned'
import { DEFAULT_PORT, PROBE_INTERVAL_MS, PROTOCOL_VERSION, ROOM_STALE_MS } from '../shared/constants'
import type {
  CreateRoomRequest,
  DiscoveredRoom,
  HostedRoom,
  RoomEndpoint,
  UpdateRoomRequest
} from '../shared/types'
import { clampPinLength, generatePin, isValidPin, randomId, randomToken } from '../utils/crypto'
import { MdnsDiscovery, type MdnsRoomRecord } from '../utils/mdns'
import { endpointKey, fingerprintFromPem, getLocalAddresses, probeRoom } from '../utils/network'
import { RoomServer, type Logger } from './server'
import type { SettingsStore } from './settings'

interface Entry {
  room: DiscoveredRoom
  /** Fingerprint advertised over mDNS, enforced when probing. */
  advertisedFingerprint: string | null
  fromMdns: boolean
  manual: boolean
  probing: boolean
}

interface Hosting {
  server: RoomServer
  hostToken: string
  pin: string | null
  pinLength: number
  fingerprint: string | null
}

export interface RoomManagerEvents {
  rooms: [rooms: DiscoveredRoom[]]
  hosted: [room: HostedRoom | null]
}

/**
 * Owns everything "room" on this machine: hosting (relay server + mDNS
 * advert + TLS identity) and discovery (mDNS browse + manual endpoints, both
 * probed via GET /info for live data such as viewer count and privacy).
 */
export class RoomManager extends EventEmitter<RoomManagerEvents> {
  private readonly mdns = new MdnsDiscovery()
  private readonly entries = new Map<string, Entry>()
  /** hostname -> certificate fingerprints we have seen for rooms on that host. */
  private readonly trusted = new Map<string, Set<string>>()
  private hosting: Hosting | null = null
  private probeTimer: NodeJS.Timeout | null = null
  private certCache: { key: string; cert: string } | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly userDataDir: string,
    private readonly log: Logger
  ) {
    super()
  }

  start(): void {
    this.mdns.on('error', (err) => this.log.warn('mdns error: %s', err.message))
    this.mdns.on('up', (rec) => this.onMdnsUp(rec))
    this.mdns.on('down', (key) => this.onMdnsDown(key))
    try {
      this.mdns.start()
    } catch (err) {
      this.log.error('mdns failed to start', err)
    }
    for (const ep of this.settings.get().manualServers) this.upsertManual(ep)
    this.probeTimer = setInterval(() => this.probeAll(), PROBE_INTERVAL_MS)
    this.probeAll()
  }

  async stop(): Promise<void> {
    if (this.probeTimer) clearInterval(this.probeTimer)
    await this.closeRoom()
    await this.mdns.stop()
  }

  listRooms(): DiscoveredRoom[] {
    const ownId = this.hosting?.server.getInfo().id
    return [...this.entries.values()]
      .map((e) => e.room)
      .filter((r) => !(ownId && r.id === ownId) && (r.id !== '' || r.source === 'manual'))
      .sort((a, b) => Number(b.reachable) - Number(a.reachable) || a.name.localeCompare(b.name))
  }

  refresh(): void {
    this.mdns.refresh()
    this.probeAll()
  }

  /**
   * Probe an arbitrary endpoint (manual entry or last-joined room). Tries the
   * requested scheme first and falls back to the other one.
   */
  async resolve(address: string, port: number, preferTls?: boolean): Promise<DiscoveredRoom> {
    const key = endpointKey(address, port)
    const existing = this.entries.get(key)
    const order = [preferTls ?? existing?.room.tls ?? true, !(preferTls ?? existing?.room.tls ?? true)]
    let lastErr: unknown
    for (const tls of order) {
      try {
        const result = await probeRoom({ address, port, tls }, 2500, existing?.advertisedFingerprint)
        if (result.info.protocol !== PROTOCOL_VERSION) throw new Error('Room runs an incompatible app version')
        if (result.fingerprint) this.trust(address, result.fingerprint)
        const room: DiscoveredRoom = {
          ...result.info,
          key,
          address,
          port,
          tls,
          source: existing?.fromMdns ? 'mdns' : 'manual',
          reachable: true,
          lastSeen: Date.now(),
          probeMs: result.ms
        }
        if (existing) {
          existing.room = room
          this.emitRooms()
        }
        return room
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Room not reachable')
  }

  async addManual(address: string, port: number): Promise<DiscoveredRoom> {
    const room = await this.resolve(address, port)
    const ep: RoomEndpoint = { address, port, tls: room.tls }
    const servers = this.settings.get().manualServers.filter((s) => endpointKey(s.address, s.port) !== room.key)
    this.settings.update({ manualServers: [...servers, ep] })
    const entry = this.upsertManual(ep)
    entry.room = { ...room, source: entry.fromMdns ? 'mdns' : 'manual' }
    this.emitRooms()
    return entry.room
  }

  removeManual(key: string): void {
    const servers = this.settings.get().manualServers.filter((s) => endpointKey(s.address, s.port) !== key)
    this.settings.update({ manualServers: servers })
    const entry = this.entries.get(key)
    if (entry) {
      entry.manual = false
      if (!entry.fromMdns) this.entries.delete(key)
    }
    this.emitRooms()
  }

  /** Used by the session's certificate verifier for self-signed room certs. */
  isTrustedCertificate(hostname: string, pem: string): boolean {
    const set = this.trusted.get(stripBrackets(hostname))
    if (!set || set.size === 0) return false
    try {
      return set.has(fingerprintFromPem(pem))
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Hosting
  // ---------------------------------------------------------------------------

  getHosted(): HostedRoom | null {
    return this.hosting ? this.describeHosted(this.hosting) : null
  }

  async createRoom(req: CreateRoomRequest): Promise<HostedRoom> {
    await this.closeRoom()
    const settings = this.settings.get()
    const tls = settings.useTls ? await this.loadCertificate() : null
    const pinLength = clampPinLength(req.pinLength)
    const pin = req.privacy === 'private' ? generatePin(pinLength) : null
    const hostToken = randomToken(32)
    const roomId = randomId()
    const name = req.name.trim() || `${settings.displayName}'s room`

    const server = new RoomServer({
      roomId,
      name,
      hostName: settings.displayName,
      privacy: req.privacy,
      pin,
      hostToken,
      tls,
      port: settings.preferredPort || DEFAULT_PORT,
      logger: this.log
    })
    const port = await server.start()
    const fingerprint = tls ? fingerprintFromPem(tls.cert) : null
    if (fingerprint) {
      this.trust('127.0.0.1', fingerprint)
      this.trust('localhost', fingerprint)
    }
    const hosting: Hosting = { server, hostToken, pin, pinLength, fingerprint }
    this.hosting = hosting
    server.on('change', () => {
      if (this.hosting === hosting) this.emit('hosted', this.describeHosted(hosting))
    })
    server.on('ended', () => {
      if (this.hosting !== hosting) return
      this.hosting = null
      void this.mdns.unpublish()
      this.emit('hosted', null)
    })
    try {
      this.mdns.publish({ roomId, port, tls: !!tls, fingerprint })
    } catch (err) {
      // Discovery is best effort: the room still works via manual IP entry.
      this.log.warn('mdns publish failed', err)
    }
    this.log.info(`hosting room "${name}" (${req.privacy}) on port ${port}`)
    const hosted = this.describeHosted(hosting)
    this.emit('hosted', hosted)
    this.emitRooms()
    return hosted
  }

  updateRoom(req: UpdateRoomRequest): HostedRoom {
    const h = this.hosting
    if (!h) throw new Error('Not hosting a room')
    if (req.pinLength !== undefined) h.pinLength = clampPinLength(req.pinLength)
    const privacy = req.privacy ?? h.server.getInfo().privacy
    let pin = h.pin
    if (req.pin === 'regenerate') pin = generatePin(h.pinLength)
    else if (req.pin !== undefined) {
      if (!isValidPin(req.pin)) throw new Error('PIN must be 4–6 digits')
      pin = req.pin
    }
    if (privacy === 'private' && !pin) pin = generatePin(h.pinLength)
    if (privacy === 'public') pin = null
    h.pin = pin
    h.server.update({ name: req.name, privacy, pin })
    this.log.info(`room updated: privacy=${privacy}${req.pin !== undefined ? ' (PIN changed)' : ''}`)
    const hosted = this.describeHosted(h)
    this.emit('hosted', hosted)
    return hosted
  }

  async closeRoom(): Promise<void> {
    const h = this.hosting
    if (!h) return
    this.hosting = null
    await this.mdns.unpublish()
    await h.server.stop()
    this.emit('hosted', null)
    this.log.info('room closed')
  }

  private describeHosted(h: Hosting): HostedRoom {
    return {
      info: h.server.getInfo(),
      port: h.server.port,
      tls: h.server.tls,
      hostToken: h.hostToken,
      pin: h.pin,
      addresses: getLocalAddresses()
    }
  }

  /**
   * The host's TLS identity. It is generated once and kept in user data so the
   * fingerprint stays stable across rooms (viewers pin it per host).
   */
  private async loadCertificate(): Promise<{ key: string; cert: string }> {
    if (this.certCache) return this.certCache
    const file = path.join(this.userDataDir, 'host-identity.json')
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { key: string; cert: string; expires: number }
      if (saved.key && saved.cert && saved.expires > Date.now() + 7 * 86_400_000) {
        this.certCache = { key: saved.key, cert: saved.cert }
        return this.certCache
      }
    } catch {
      // generate below
    }
    const notAfter = new Date(Date.now() + 2 * 365 * 86_400_000)
    const pems = await generateCert([{ name: 'commonName', value: `ScreenShare ${os.hostname()}` }], {
      keyType: 'ec',
      curve: 'P-256',
      algorithm: 'sha256',
      notAfterDate: notAfter,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            ...getLocalAddresses().map((ip) => ({ type: 7 as const, ip }))
          ]
        }
      ]
    })
    this.certCache = { key: pems.private, cert: pems.cert }
    try {
      fs.writeFileSync(file, JSON.stringify({ ...this.certCache, expires: notAfter.getTime() }), { mode: 0o600 })
    } catch (err) {
      this.log.warn('could not persist host identity', err)
    }
    return this.certCache
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  private onMdnsUp(rec: MdnsRoomRecord): void {
    let entry = this.entries.get(rec.key)
    if (!entry) {
      entry = {
        room: placeholder(rec.key, rec.address, rec.port, rec.tls, 'mdns'),
        advertisedFingerprint: null,
        fromMdns: true,
        manual: false,
        probing: false
      }
      this.entries.set(rec.key, entry)
    }
    entry.fromMdns = true
    entry.room.tls = rec.tls
    entry.room.source = 'mdns'
    entry.room.id ||= rec.roomId
    entry.advertisedFingerprint = rec.fingerprint
    if (rec.fingerprint) this.trust(rec.address, rec.fingerprint)
    void this.probe(entry)
  }

  private onMdnsDown(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.fromMdns = false
    if (entry.manual) {
      entry.room.source = 'manual'
      void this.probe(entry)
    } else {
      this.entries.delete(key)
      this.emitRooms()
    }
  }

  private upsertManual(ep: RoomEndpoint): Entry {
    const key = endpointKey(ep.address, ep.port)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = {
        room: placeholder(key, ep.address, ep.port, ep.tls, 'manual'),
        advertisedFingerprint: null,
        fromMdns: false,
        manual: true,
        probing: false
      }
      this.entries.set(key, entry)
    }
    entry.manual = true
    return entry
  }

  private probeAll(): void {
    for (const entry of this.entries.values()) void this.probe(entry)
  }

  private async probe(entry: Entry): Promise<void> {
    if (entry.probing) return
    entry.probing = true
    const { address, port, tls } = entry.room
    try {
      const result = await probeRoom({ address, port, tls }, 2500, entry.advertisedFingerprint)
      if (result.fingerprint) this.trust(address, result.fingerprint)
      entry.room = {
        ...entry.room,
        ...result.info,
        reachable: result.info.protocol === PROTOCOL_VERSION,
        lastSeen: Date.now(),
        probeMs: result.ms
      }
    } catch (err) {
      const stale = Date.now() - entry.room.lastSeen > ROOM_STALE_MS
      if (entry.room.reachable) this.log.debug(`probe failed for ${entry.room.key}: ${(err as Error).message}`)
      entry.room = { ...entry.room, reachable: false }
      if (stale && !entry.manual && this.entries.get(entry.room.key) === entry) {
        this.entries.delete(entry.room.key)
      }
    } finally {
      entry.probing = false
    }
    this.emitRooms()
  }

  private trust(hostname: string, fingerprint: string): void {
    const host = stripBrackets(hostname)
    let set = this.trusted.get(host)
    if (!set) this.trusted.set(host, (set = new Set()))
    set.add(fingerprint)
  }

  private lastEmitted = ''
  private emitRooms(): void {
    const rooms = this.listRooms()
    const snapshot = JSON.stringify(rooms.map(({ lastSeen: _l, probeMs: _p, ...r }) => r))
    if (snapshot === this.lastEmitted) return
    this.lastEmitted = snapshot
    this.emit('rooms', rooms)
  }
}

function placeholder(
  key: string,
  address: string,
  port: number,
  tls: boolean,
  source: DiscoveredRoom['source']
): DiscoveredRoom {
  return {
    key,
    address,
    port,
    tls,
    source,
    reachable: false,
    lastSeen: Date.now(),
    id: '',
    name: `${address}:${port}`,
    hostName: '',
    privacy: 'public',
    viewerCount: 0,
    maxUsers: 0,
    streams: 0,
    protocol: 0,
    startedAt: 0
  }
}

function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, '')
}
