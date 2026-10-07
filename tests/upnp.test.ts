import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { RouterNetwork } from '../src/main/portMapping'
import { isLocalIPv4, isPublicIPv4 } from '../src/shared/vpn'
import { fetchPublicAddress } from '../src/utils/publicIp'
import {
  addPortMapping,
  deletePortMapping,
  discoverIgd,
  getExternalAddress,
  parseServices,
  parseSsdpLocation,
  soapEnvelope,
  xmlEscape,
  xmlValue
} from '../src/utils/upnp'
import { FakeRouter } from './fakeRouter'

const quiet = { debug() {}, info() {}, warn() {}, error() {} }
let router: FakeRouter | null = null
const servers: http.Server[] = []

afterEach(async () => {
  await router?.stop()
  router = null
  for (const s of servers.splice(0)) await new Promise<void>((resolve) => (s.closeAllConnections(), s.close(() => resolve())))
})

async function startRouter(type?: string): Promise<FakeRouter> {
  router = new FakeRouter(type)
  await router.start()
  return router
}

describe('addresses', () => {
  it('knows which addresses nobody on the internet can reach', () => {
    for (const a of ['10.0.0.1', '192.168.1.4', '172.16.0.1', '172.31.255.1', '100.64.0.1', '100.127.1.1', '127.0.0.1', '169.254.3.3', '0.0.0.0']) {
      expect(isPublicIPv4(a), a).toBe(false)
    }
    for (const a of ['189.112.94.20', '8.8.8.8', '172.32.0.1', '100.63.0.1', '100.128.0.1']) expect(isPublicIPv4(a), a).toBe(true)
    expect(isPublicIPv4('nope')).toBe(false)
  })

  it('knows our own network', () => {
    expect(isLocalIPv4('192.168.1.1')).toBe(true)
    expect(isLocalIPv4('127.0.0.1')).toBe(true)
    expect(isLocalIPv4('8.8.8.8')).toBe(false)
  })
})

describe('UPnP messages', () => {
  it('reads the search answer and the device description', () => {
    expect(parseSsdpLocation('HTTP/1.1 200 OK\r\nLocation: http://192.168.1.1:5000/rootDesc.xml\r\nST: x\r\n\r\n')).toBe('http://192.168.1.1:5000/rootDesc.xml')
    expect(parseSsdpLocation('HTTP/1.1 200 OK\r\n\r\n')).toBeNull()
    const xml = '<service><serviceType>urn:a:1</serviceType><controlURL>/ctl</controlURL></service><service><serviceType>urn:b:1</serviceType></service>'
    expect(parseServices(xml)).toEqual([{ serviceType: 'urn:a:1', controlUrl: '/ctl' }])
  })

  it('builds a SOAP call with escaped values, and reads values whatever the prefix', () => {
    const xml = soapEnvelope('urn:x:1', 'AddPortMapping', { NewPortMappingDescription: 'a <b> & "c"', NewExternalPort: 47800 })
    expect(xml).toContain('<NewPortMappingDescription>a &lt;b&gt; &amp; &quot;c&quot;</NewPortMappingDescription>')
    expect(xml).toContain('<NewExternalPort>47800</NewExternalPort>')
    expect(xmlEscape(`<'&">`)).toBe('&lt;&apos;&amp;&quot;&gt;')
    expect(xmlValue('<u:R><NewExternalIPAddress>1.2.3.4</NewExternalIPAddress></u:R>', 'NewExternalIPAddress')).toBe('1.2.3.4')
    expect(xmlValue('<ns:errorCode>725</ns:errorCode>', 'errorCode')).toBe('725')
  })
})

describe('talking to a router', () => {
  it('finds it, asks for its address, opens a port and closes it', async () => {
    const r = await startRouter()
    const igd = await discoverIgd({ ssdp: r.ssdp, timeoutMs: 2000 })
    expect(igd).not.toBeNull()
    expect(igd!.serviceType).toBe('urn:schemas-upnp-org:service:WANIPConnection:1')
    expect(igd!.localAddress).toBe('127.0.0.1')

    expect(await getExternalAddress(igd!)).toBe('203.0.113.9')
    await addPortMapping(igd!, 47800, 'TCP', 'test', 3600)
    await addPortMapping(igd!, 47800, 'UDP', 'test', 3600)
    expect([...r.mappings.keys()].sort()).toEqual(['TCP:47800', 'UDP:47800'])
    expect(r.mappings.get('TCP:47800')).toEqual({ internalClient: '127.0.0.1', lease: 3600 })
    await deletePortMapping(igd!, 47800, 'TCP')
    expect([...r.mappings.keys()]).toEqual(['UDP:47800'])
  })

  it('prefers the newer service when a router offers both', async () => {
    const r = await startRouter('urn:schemas-upnp-org:service:WANPPPConnection:1')
    const igd = await discoverIgd({ ssdp: r.ssdp, timeoutMs: 2000 })
    expect(igd?.serviceType).toBe('urn:schemas-upnp-org:service:WANPPPConnection:1')
  })

  it('retries with no expiry when the router only takes permanent mappings', async () => {
    const r = await startRouter()
    r.permanentOnly = true
    const igd = (await discoverIgd({ ssdp: r.ssdp, timeoutMs: 2000 }))!
    await addPortMapping(igd, 47800, 'TCP', 'test', 3600)
    expect(r.mappings.get('TCP:47800')?.lease).toBe(0)
  })

  it('reports what the router refused', async () => {
    const r = await startRouter()
    r.failAddWith = 718
    const igd = (await discoverIgd({ ssdp: r.ssdp, timeoutMs: 2000 }))!
    await expect(addPortMapping(igd, 47800, 'TCP', 'test', 3600)).rejects.toThrow(/UPnP error 718/)
  })

  it('ignores an answer that points at another machine, or at the internet', async () => {
    const r = await startRouter()
    for (const host of ['10.255.255.1', '8.8.8.8']) {
      r.locationHost = host
      expect(await discoverIgd({ ssdp: r.ssdp, timeoutMs: 500 }), host).toBeNull()
    }
  })

  it('gives up quietly when no router answers', async () => {
    expect(await discoverIgd({ ssdp: { address: '127.0.0.1', port: 9 }, timeoutMs: 300 })).toBeNull()
  })

  it('treats an unknown address (router not online) as none', async () => {
    const r = await startRouter()
    r.externalAddress = '0.0.0.0'
    const igd = (await discoverIgd({ ssdp: r.ssdp, timeoutMs: 2000 }))!
    expect(await getExternalAddress(igd)).toBeNull()
  })
})

async function publicIpServer(answer: string, status = 200): Promise<string> {
  const server = http.createServer((_req, res) => res.writeHead(status).end(answer))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('the public address', () => {
  it('reads a public address, and refuses anything else', async () => {
    expect(await fetchPublicAddress(await publicIpServer('189.112.94.20\n'))).toBe('189.112.94.20')
    expect(await fetchPublicAddress(await publicIpServer('192.168.1.4'))).toBeNull()
    expect(await fetchPublicAddress(await publicIpServer('<html>nope</html>'))).toBeNull()
    expect(await fetchPublicAddress(await publicIpServer('189.112.94.20', 500))).toBeNull()
  })

  it('is null when nothing answers', async () => {
    expect(await fetchPublicAddress('http://127.0.0.1:9', 500)).toBeNull()
  })
})

describe('RouterNetwork', () => {
  it('detects the address and a router that can open the port', async () => {
    const r = await startRouter()
    const url = await publicIpServer('203.0.113.9')
    const detected = await new RouterNetwork(quiet, { discover: { ssdp: r.ssdp, timeoutMs: 1500 }, publicIpUrl: url }).detect()
    expect(detected).toMatchObject({ publicAddress: '203.0.113.9', upnp: true, behindCgnat: false })
  })

  it('says so when the provider shares the address (CGNAT)', async () => {
    const r = await startRouter()
    r.externalAddress = '100.72.5.9' // the router itself sits behind the provider's NAT
    const url = await publicIpServer('203.0.113.9')
    const detected = await new RouterNetwork(quiet, { discover: { ssdp: r.ssdp, timeoutMs: 1500 }, publicIpUrl: url }).detect()
    expect(detected).toMatchObject({ publicAddress: '203.0.113.9', upnp: true, behindCgnat: true })
  })

  it('also sees CGNAT when the router and the internet disagree', async () => {
    const r = await startRouter()
    const url = await publicIpServer('198.51.100.7')
    const detected = await new RouterNetwork(quiet, { discover: { ssdp: r.ssdp, timeoutMs: 1500 }, publicIpUrl: url }).detect()
    expect(detected.behindCgnat).toBe(true)
  })

  it('falls back to the router\'s own address when the outside service is unreachable', async () => {
    const r = await startRouter()
    const detected = await new RouterNetwork(quiet, { discover: { ssdp: r.ssdp, timeoutMs: 1500 }, publicIpUrl: 'http://127.0.0.1:9' }).detect()
    expect(detected).toMatchObject({ publicAddress: '203.0.113.9', upnp: true, behindCgnat: false })
  })

  it('knows nothing about CGNAT without a router, but still gives the outside address', async () => {
    const url = await publicIpServer('203.0.113.9')
    const detected = await new RouterNetwork(quiet, { discover: { ssdp: { address: '127.0.0.1', port: 9 }, timeoutMs: 300 }, publicIpUrl: url }).detect()
    expect(detected).toMatchObject({ publicAddress: '203.0.113.9', upnp: false, behindCgnat: null })
  })

  it('opens TCP and UDP for the room and closes them with it', async () => {
    const r = await startRouter()
    const network = new RouterNetwork(quiet, { discover: { ssdp: r.ssdp, timeoutMs: 1500 } })
    expect(await network.openPort(47800)).toEqual({ status: 'opened' })
    expect([...r.mappings.keys()].sort()).toEqual(['TCP:47800', 'UDP:47800'])
    await network.closePorts()
    expect(r.mappings.size).toBe(0)
    await network.closePorts() // nothing left to close
  })

  it('says when there is no router to ask, or it refused (and leaves nothing open)', async () => {
    const none = new RouterNetwork(quiet, { discover: { ssdp: { address: '127.0.0.1', port: 9 }, timeoutMs: 300 } })
    expect(await none.openPort(47800)).toEqual({ status: 'unavailable' })

    const r = await startRouter()
    const network = new RouterNetwork(quiet, { discover: { ssdp: r.ssdp, timeoutMs: 1500 } })
    r.failAddWith = 718
    expect(await network.openPort(47800)).toEqual({ status: 'failed' })
    expect(r.mappings.size).toBe(0)
  })
})
