import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { VpnHost } from '../src/main/vpn/host'
import { VpnManager, type VpnEnvironment } from '../src/main/vpn/manager'
import type { TunnelConfig, VpnTunnel } from '../src/main/vpn/tunnel'
import { RoomServer } from '../src/main/server'
import { decodeInvite, networkOf } from '../src/shared/vpn'
import { generateKeyPair, type UapiPeer } from '../src/utils/wireguard'

/** Records what it was asked to do instead of touching the network. */
class RecordingTunnel implements VpnTunnel {
  config: TunnelConfig | null = null
  peers = new Map<string, UapiPeer>()
  downCount = 0
  failSetPeer = false
  async up(config: TunnelConfig): Promise<{ interface: string }> {
    this.config = config
    return { interface: 'test0' }
  }
  async setPeer(peer: UapiPeer): Promise<void> {
    if (this.failSetPeer) throw new Error('boom')
    this.peers.set(peer.publicKey, peer)
  }
  async removePeer(publicKey: string): Promise<void> {
    this.peers.delete(publicKey)
  }
  async down(): Promise<void> {
    this.downCount++
  }
}

function environment(tunnels: RecordingTunnel[], opts: Partial<VpnEnvironment> = {}): VpnEnvironment {
  return {
    availability: async () => ({ ok: true, reason: null }),
    createTunnel: () => {
      const tunnel = new RecordingTunnel()
      tunnels.push(tunnel)
      return tunnel
    },
    localAddresses: () => ['192.168.1.4'],
    roomAddress: (invite) => invite.hostAddress,
    ...opts
  }
}

const quiet = { debug() {}, info() {}, warn() {}, error() {} }
let server: RoomServer | null = null
let hostManager: VpnManager | null = null

/** A host: room server + VpnHost + manager, as RoomManager wires them. */
async function startHost(tunnels: RecordingTunnel[]): Promise<{ host: VpnHost; port: number; invite: string }> {
  hostManager = new VpnManager(environment(tunnels), quiet)
  const host = await hostManager.createHost()
  server = new RoomServer({
    roomId: 'r',
    name: 'VPN room',
    hostName: 'Alice',
    privacy: 'public',
    pin: null,
    hostToken: 't',
    port: 0,
    bindAddress: '127.0.0.1',
    vpn: host
  })
  const port = await server.start()
  const { invite, interface: iface } = await host.start({ endpoint: '127.0.0.1', port, tls: false, fingerprint: null })
  hostManager.hostReady(iface)
  return { host, port, invite }
}

function post(port: number, path: string, body: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let text = ''
      res.on('data', (c) => (text += c))
      res.on('end', () => {
        let parsed: any = null
        try {
          parsed = text ? JSON.parse(text) : null
        } catch {
          parsed = text
        }
        resolve({ status: res.statusCode ?? 0, body: parsed })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

afterEach(async () => {
  await server?.stop()
  await hostManager?.stop()
  server = hostManager = null
})

describe('POST /vpn/enroll', () => {
  it('adds the guest to the tunnel and tells it its address', async () => {
    const tunnels: RecordingTunnel[] = []
    const { port, invite } = await startHost(tunnels)
    const secret = decodeInvite(invite)!.secret
    const guest = generateKeyPair()

    const res = await post(port, '/vpn/enroll', JSON.stringify({ secret, publicKey: guest.publicKey, clientId: 'guest-1' }))

    expect(res.status).toBe(200)
    expect(res.body.address).toMatch(/^10\.77\.\d+\.2$/)
    expect(res.body.hostAddress).toBe(decodeInvite(invite)!.hostAddress)
    expect(res.body.prefix).toBe(24)
    expect(tunnels[0].peers.get(guest.publicKey)?.allowedIps).toEqual([`${res.body.address}/32`])
    // The host is the hub: it listens on the room's port and relays between guests.
    expect(tunnels[0].config).toMatchObject({ forward: true, listenPort: port, peers: [] })
  })

  it('gives the same guest the same address, and replaces its old key', async () => {
    const tunnels: RecordingTunnel[] = []
    const { port, invite } = await startHost(tunnels)
    const secret = decodeInvite(invite)!.secret
    const first = generateKeyPair()
    const second = generateKeyPair()

    const a = await post(port, '/vpn/enroll', JSON.stringify({ secret, publicKey: first.publicKey, clientId: 'guest-1' }))
    const b = await post(port, '/vpn/enroll', JSON.stringify({ secret, publicKey: second.publicKey, clientId: 'guest-1' }))

    expect(b.body.address).toBe(a.body.address)
    expect([...tunnels[0].peers.keys()]).toEqual([second.publicKey])
  })

  it('refuses a key that already belongs to another guest', async () => {
    const tunnels: RecordingTunnel[] = []
    const { port, invite } = await startHost(tunnels)
    const secret = decodeInvite(invite)!.secret
    const key = generateKeyPair().publicKey

    await post(port, '/vpn/enroll', JSON.stringify({ secret, publicKey: key, clientId: 'guest-1' }))
    const stolen = await post(port, '/vpn/enroll', JSON.stringify({ secret, publicKey: key, clientId: 'guest-2' }))

    expect(stolen.status).toBe(400)
    expect(tunnels[0].peers.size).toBe(1)
  })

  it('refuses a wrong secret, then locks the address out', async () => {
    const tunnels: RecordingTunnel[] = []
    const { port } = await startHost(tunnels)
    const body = (n: number): string =>
      JSON.stringify({ secret: 'wrong-secret-wrong-secret', publicKey: generateKeyPair().publicKey, clientId: `g${n}` })

    const first = await post(port, '/vpn/enroll', body(1))
    expect(first.status).toBe(401)
    expect(first.body).toMatchObject({ error: 'bad_secret', attemptsLeft: 2 })
    await post(port, '/vpn/enroll', body(2))
    const third = await post(port, '/vpn/enroll', body(3))
    expect(third.status).toBe(429)
    expect(tunnels[0].peers.size).toBe(0)
  })

  it('stops at the number of seats in the room', async () => {
    const tunnels: RecordingTunnel[] = []
    const { port, invite } = await startHost(tunnels)
    const secret = decodeInvite(invite)!.secret
    for (let i = 0; i < 9; i++) {
      const ok = await post(port, '/vpn/enroll', JSON.stringify({ secret, publicKey: generateKeyPair().publicKey, clientId: `g${i}` }))
      expect(ok.status).toBe(200)
    }
    const full = await post(port, '/vpn/enroll', JSON.stringify({ secret, publicKey: generateKeyPair().publicKey, clientId: 'late' }))
    expect(full.status).toBe(409)
  })

  it('answers 500 and frees the address when the tunnel fails', async () => {
    const tunnels: RecordingTunnel[] = []
    const { port, invite } = await startHost(tunnels)
    const secret = decodeInvite(invite)!.secret
    tunnels[0].failSetPeer = true
    const failed = await post(port, '/vpn/enroll', JSON.stringify({ secret, publicKey: generateKeyPair().publicKey, clientId: 'g' }))
    expect(failed.status).toBe(500)
    tunnels[0].failSetPeer = false
    const retry = await post(port, '/vpn/enroll', JSON.stringify({ secret, publicKey: generateKeyPair().publicKey, clientId: 'g' }))
    expect(retry.body.address).toMatch(/\.2$/)
  })

  it('rejects malformed and oversized bodies', async () => {
    const tunnels: RecordingTunnel[] = []
    const { port } = await startHost(tunnels)
    expect((await post(port, '/vpn/enroll', 'not json')).status).toBe(400)
    expect((await post(port, '/vpn/enroll', '{}')).status).toBe(400)
    expect((await post(port, '/vpn/enroll', JSON.stringify({ pad: 'x'.repeat(5000) }))).status).toBe(413)
  })

  it('does not exist on a room without a VPN', async () => {
    server = new RoomServer({ roomId: 'r', name: 'Plain', hostName: 'A', privacy: 'public', pin: null, hostToken: 't', port: 0, bindAddress: '127.0.0.1' })
    const port = await server.start()
    expect((await post(port, '/vpn/enroll', '{}')).status).toBe(404)
  })
})

describe('joining with an invite', () => {
  it('enrols, brings the tunnel up with the host as its only peer, and returns where the room is', async () => {
    const hostTunnels: RecordingTunnel[] = []
    const { port, invite } = await startHost(hostTunnels)
    const guestTunnels: RecordingTunnel[] = []
    const guest = new VpnManager(environment(guestTunnels), quiet)

    const target = await guest.join(invite, 'install-1')

    const hostInvite = decodeInvite(invite)!
    expect(target).toEqual({ address: hostInvite.hostAddress, port, tls: false, fingerprint: null })
    expect(guest.status()).toMatchObject({ mode: 'joined', interface: 'test0' })
    const config = guestTunnels[0].config!
    expect(config.forward).toBe(false)
    expect(networkOf(config.address)).toBe(networkOf(hostInvite.hostAddress))
    expect(config.peers).toEqual([
      {
        publicKey: hostInvite.hostKey,
        endpoint: `127.0.0.1:${port}`,
        allowedIps: [`${networkOf(hostInvite.hostAddress)}.0/24`],
        keepalive: 25
      }
    ])
    expect(hostManager!.status().peers).toBe(1)

    await guest.leave()
    expect(guest.status().mode).toBe('off')
    expect(guestTunnels[0].downCount).toBe(1)
  })

  it('reuses the guest identity, so joining again keeps its address', async () => {
    const { invite } = await startHost([])
    const tunnels: RecordingTunnel[] = []
    const guest = new VpnManager(environment(tunnels), quiet)
    await guest.join(invite, 'install-1')
    const first = tunnels[0].config!.address
    await guest.leave()
    await guest.join(invite, 'install-1')
    expect(tunnels[1].config!.address).toBe(first)
  })

  it('explains what went wrong', async () => {
    const { port, invite } = await startHost([])
    const guest = new VpnManager(environment([]), quiet)

    await expect(guest.join('hello', 'c')).rejects.toThrow(/not a ScreenShare VPN invite/)

    const forged = invite.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))
    await expect(guest.join(forged, 'c')).rejects.toThrow()

    const wrongSecret = decodeInvite(invite)!
    const { encodeInvite } = await import('../src/shared/vpn')
    await expect(guest.join(encodeInvite({ ...wrongSecret, secret: 'z'.repeat(32) }), 'c')).rejects.toThrow(/did not accept this invite/)

    await expect(guest.join(encodeInvite({ ...wrongSecret, port: port + 1 }), 'c')).rejects.toThrow(/Could not reach the host/)
    expect(guest.status().mode).toBe('off')
  })

  it('refuses when this computer already uses the VPN network', async () => {
    const { invite } = await startHost([])
    const hostInvite = decodeInvite(invite)!
    const guest = new VpnManager(environment([], { localAddresses: () => [`${networkOf(hostInvite.hostAddress)}.77`] }), quiet)
    await expect(guest.join(invite, 'c')).rejects.toThrow(/already uses/)
  })

  it('tells the user what to install when VPNs are not available', async () => {
    const { invite } = await startHost([])
    const guest = new VpnManager(environment([], { availability: async () => ({ ok: false, reason: 'Install wireguard-go' }) }), quiet)
    await expect(guest.join(invite, 'c')).rejects.toThrow('Install wireguard-go')
  })

  it('cannot join twice, or join while hosting', async () => {
    const { invite } = await startHost([])
    await expect(hostManager!.join(invite, 'c')).rejects.toThrow(/already hosting/)
    const guest = new VpnManager(environment([]), quiet)
    await guest.join(invite, 'c')
    await expect(guest.join(invite, 'c')).rejects.toThrow(/already connected/)
    await guest.leave()
  })

  it('takes the tunnel down when the host stops', async () => {
    const tunnels: RecordingTunnel[] = []
    await startHost(tunnels)
    await hostManager!.stopHost()
    expect(tunnels[0].downCount).toBe(1)
    expect(hostManager!.status().mode).toBe('off')
  })
})
