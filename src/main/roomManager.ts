import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generate as generateCert } from 'selfsigned'
import { DEFAULT_PORT, PROBE_INTERVAL_MS, PROTOCOL_VERSION, ROOM_STALE_MS, VPN_CONNECT_TIMEOUT_MS } from '../shared/constants'
import type {
  CreateRoomRequest,
  DiscoveredRoom,
  HostedRoom,
  HostedVpn,
  PortMappingStatus,
  RoomEndpoint,
  UpdateRoomRequest
} from '../shared/types'
import { incompatibleRoomMessage } from '../shared/version'
import { isValidEndpointHost } from '../shared/vpn'
import { clampPinLength, generatePin, isValidPin, randomId, randomToken } from '../utils/crypto'
import { MdnsDiscovery, type MdnsRoomRecord } from '../utils/mdns'
import { endpointKey, fingerprintFromPem, getLocalAddresses, probeRoom } from '../utils/network'
import { RoomServer, type Logger } from './server'
import type { SettingsStore } from './settings'
import type { VpnManager } from './vpn/manager'

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
  /** The VPN this room opened, if any. */
  vpn: { invite: string; endpoint: string; portMapping: PortMappingStatus } | null
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
  /** Key of the room list entry for the VPN room we joined, so it can be dropped when we disconnect. */
  private vpnRoomKey: string | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly userDataDir: string,
    private readonly log: Logger,
    /** Our app version, reported by the rooms we host and used in "update to join" messages. */
    private readonly appVersion: string,
    private readonly vpn: VpnManager
  ) {
    super()
    // A guest enrolling changes the peer count the host's panel shows.
    vpn.on('status', () => {
      if (this.hosting?.vpn) this.emit('hosted', this.describeHosted(this.hosting))
    })
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
    await this.vpn.stop()
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
        const incompatible = incompatibleRoomMessage(result.info, {
          protocol: PROTOCOL_VERSION,
          appVersion: this.appVersion
        })
        if (incompatible) throw new Error(incompatible)
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

    const vpnHost = req.vpn ? await this.vpn.createHost() : null
    const server = new RoomServer({
      roomId,
      name,
      hostName: settings.displayName,
      privacy: req.privacy,
      pin,
      hostToken,
      tls,
      port: settings.preferredPort || DEFAULT_PORT,
      appVersion: this.appVersion,
      logger: this.log,
      vpn: vpnHost ?? undefined
    })
    let port: number
    let vpnInfo: Hosting['vpn'] = null
    try {
      port = await server.start()
      if (vpnHost && req.vpn) {
        // No address typed: use what the internet sees, or else our own on the local network.
        const detected = req.vpn.endpoint?.trim() ? null : await this.vpn.detect()
        const endpoint = req.vpn.endpoint?.trim() || detected?.publicAddress || detected?.localAddress || getLocalAddresses()[0] || ''
        if (!isValidEndpointHost(endpoint)) throw new Error('Enter the address your guests will connect to, like 203.0.113.7 or home.example.org')
        const { invite, interface: iface } = await vpnHost.start({
          endpoint,
          port,
          tls: !!tls,
          fingerprint: tls ? fingerprintFromPem(tls.cert) : null
        })
        this.vpn.hostReady(iface)
        const portMapping = req.vpn.openPort ? (await this.vpn.openPort(port)).status : 'off'
        vpnInfo = { invite, endpoint, portMapping }
      }
    } catch (err) {
      await server.stop().catch(() => undefined)
      await this.vpn.stopHost()
      throw err
    }
    const fingerprint = tls ? fingerprintFromPem(tls.cert) : null
    if (fingerprint) {
      this.trust('127.0.0.1', fingerprint)
      this.trust('localhost', fingerprint)
    }
    const hosting: Hosting = { server, hostToken, pin, pinLength, fingerprint, vpn: vpnInfo }
    this.hosting = hosting
    server.on('change', () => {
      if (this.hosting === hosting) this.emit('hosted', this.describeHosted(hosting))
    })
    server.on('ended', () => {
      if (this.hosting !== hosting) return
      this.hosting = null
      void this.mdns.unpublish()
      void this.vpn.stopHost()
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
    await this.vpn.stopHost()
    this.emit('hosted', null)
    this.log.info('room closed')
  }

  private describeHosted(h: Hosting): HostedRoom {
    const vpn: HostedVpn | undefined = h.vpn
      ? { ...h.vpn, address: this.vpn.status().address ?? '', peers: this.vpn.status().peers }
      : undefined
    return {
      info: h.server.getInfo(),
      port: h.server.port,
      tls: h.server.tls,
      hostToken: h.hostToken,
      pin: h.pin,
      addresses: getLocalAddresses(),
      vpn
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
  // VPN rooms (guest side)
  // ---------------------------------------------------------------------------

  /**
   * Enrols with the host the invite came from, brings the tunnel up, and waits for
   * the room to answer through it. The room then shows in the list like any other,
   * until the VPN is disconnected.
   */
  async joinVpn(invite: string): Promise<DiscoveredRoom> {
    const target = await this.vpn.join(invite, this.settings.get().clientId)
    try {
      if (target.fingerprint) this.trust(target.address, target.fingerprint)
      const room = await this.resolveWhenUp(target.address, target.port, target.tls)
      const entry = this.upsertManual({ address: room.address, port: room.port, tls: room.tls })
      entry.manual = true
      entry.room = room
      this.vpnRoomKey = room.key
      this.emitRooms()
      return room
    } catch (err) {
      await this.vpn.leave()
      throw err
    }
  }

  async leaveVpn(): Promise<void> {
    await this.vpn.leave()
    if (this.vpnRoomKey) {
      this.entries.delete(this.vpnRoomKey)
      this.vpnRoomKey = null
      this.emitRooms()
    }
  }

  /** The first packets of a new tunnel take a moment (handshake), so keep asking for a while. */
  private async resolveWhenUp(address: string, port: number, tls: boolean): Promise<DiscoveredRoom> {
    const deadline = Date.now() + VPN_CONNECT_TIMEOUT_MS
    let lastError: unknown
    while (Date.now() < deadline) {
      try {
        return await this.resolve(address, port, tls)
      } catch (err) {
        lastError = err
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
    throw new Error(
      `Remote is connected, but the room does not answer through it (${(lastError as Error | undefined)?.message ?? 'no answer'}). ` +
        `Check that UDP port ${port} reaches the host.`
    )
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
