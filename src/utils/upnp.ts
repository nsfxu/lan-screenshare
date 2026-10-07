import dgram from 'node:dgram'
import http from 'node:http'
import { isIPv4, isLocalIPv4 } from '../shared/vpn'

/**
 * A small UPnP Internet Gateway client: find the router (SSDP), ask it for its public
 * address, and open or close a port (SOAP). No dependencies. A router answers only
 * when UPnP is on, which many have off.
 */

export interface Igd {
  controlUrl: string
  serviceType: string
  /** Our address on the router's network: where it should send the opened port. */
  localAddress: string
}

const SERVICE_PREFERENCE = [
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1'
]
const SEARCH_TARGETS = ['urn:schemas-upnp-org:device:InternetGatewayDevice:2', 'urn:schemas-upnp-org:device:InternetGatewayDevice:1']
const MAX_XML_BYTES = 256 * 1024

export function ssdpSearch(target: string): string {
  return ['M-SEARCH * HTTP/1.1', 'HOST: 239.255.255.250:1900', 'MAN: "ssdp:discover"', 'MX: 2', `ST: ${target}`, '', ''].join('\r\n')
}

export function parseSsdpLocation(message: string): string | null {
  const match = /^location:\s*(\S+)\s*$/im.exec(message)
  return match ? match[1] : null
}

export function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** The first text inside `<tag>…</tag>` (any namespace prefix), or null. */
export function xmlValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>([^<]*)</(?:[\\w-]+:)?${tag}>`, 'i').exec(xml)
  return match ? match[1].trim() : null
}

/** The services of a device description, as {serviceType, controlURL}. */
export function parseServices(xml: string): { serviceType: string; controlUrl: string }[] {
  const found: { serviceType: string; controlUrl: string }[] = []
  for (const block of xml.match(/<service>[\s\S]*?<\/service>/gi) ?? []) {
    const serviceType = xmlValue(block, 'serviceType')
    const controlUrl = xmlValue(block, 'controlURL')
    if (serviceType && controlUrl) found.push({ serviceType, controlUrl })
  }
  return found
}

export function soapEnvelope(serviceType: string, action: string, args: Record<string, string | number>): string {
  const body = Object.entries(args)
    .map(([name, value]) => `<${name}>${xmlEscape(String(value))}</${name}>`)
    .join('')
  return (
    '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${xmlEscape(serviceType)}">${body}</u:${action}></s:Body></s:Envelope>`
  )
}

export interface DiscoverOptions {
  /** Where to send the search; tests point it at a fake router. */
  ssdp?: { address: string; port: number }
  timeoutMs?: number
}

/** Looks for a router that speaks UPnP; null when none answers in time. */
export function discoverIgd(options: DiscoverOptions = {}): Promise<Igd | null> {
  const target = options.ssdp ?? { address: '239.255.255.250', port: 1900 }
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const seen = new Set<string>()
    let done = false
    const finish = (igd: Igd | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // already closed
      }
      resolve(igd)
    }
    const timer = setTimeout(() => finish(null), options.timeoutMs ?? 3000)
    socket.on('error', () => finish(null))
    socket.on('message', (msg, rinfo) => {
      const location = parseSsdpLocation(msg.toString('utf8'))
      if (!location || seen.has(location)) return
      seen.add(location)
      void describe(location, rinfo.address).then((igd) => igd && finish(igd))
    })
    socket.bind(0, () => {
      for (const st of SEARCH_TARGETS) socket.send(ssdpSearch(st), target.port, target.address, () => undefined)
    })
  })
}

/**
 * Reads the router's description. Only a device on our own network, and only the
 * address that answered the search: a stranger can't point us at some other server.
 */
async function describe(location: string, from: string): Promise<Igd | null> {
  let base: URL
  try {
    base = new URL(location)
  } catch {
    return null
  }
  if (base.protocol !== 'http:' || base.hostname !== from || !isLocalIPv4(from)) return null
  try {
    const { status, body, localAddress } = await httpRequest(base.toString(), 'GET')
    if (status !== 200) return null
    const services = parseServices(body)
    const best = SERVICE_PREFERENCE.map((type) => services.find((s) => s.serviceType === type)).find(Boolean)
    if (!best) return null
    const urlBase = xmlValue(body, 'URLBase')
    const control = new URL(best.controlUrl, urlBase && /^http:\/\//.test(urlBase) ? urlBase : base)
    if (control.hostname !== from || !isIPv4(localAddress)) return null
    return { controlUrl: control.toString(), serviceType: best.serviceType, localAddress }
  } catch {
    return null
  }
}

interface HttpResult {
  status: number
  body: string
  localAddress: string
}

function httpRequest(url: string, method: 'GET' | 'POST', headers: Record<string, string> = {}, payload?: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, timeout: 4000 }, (res) => {
      // Read it now: by the time the body ends, the socket may already be back in the pool.
      const localAddress = res.socket?.localAddress ?? ''
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        body += chunk
        if (body.length > MAX_XML_BYTES) req.destroy(new Error('response too large'))
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, localAddress }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(payload)
  })
}

async function soap(igd: Igd, action: string, args: Record<string, string | number>): Promise<string> {
  const { status, body } = await httpRequest(
    igd.controlUrl,
    'POST',
    { 'content-type': 'text/xml; charset="utf-8"', soapaction: `"${igd.serviceType}#${action}"` },
    soapEnvelope(igd.serviceType, action, args)
  )
  if (status !== 200) {
    const code = xmlValue(body, 'errorCode')
    throw new Error(`${action} refused${code ? ` (UPnP error ${code})` : ` (HTTP ${status})`}`)
  }
  return body
}

/** The router's address on the internet, or null if it doesn't know (not connected yet). */
export async function getExternalAddress(igd: Igd): Promise<string | null> {
  const address = xmlValue(await soap(igd, 'GetExternalIPAddress', {}), 'NewExternalIPAddress')
  return isIPv4(address) && address !== '0.0.0.0' ? address : null
}

export type PortProtocol = 'TCP' | 'UDP'

/**
 * Opens `port` (the same number outside and in) to this computer. Routers that only
 * allow permanent mappings (UPnP error 725) get one with no expiry, so the caller must
 * delete it.
 */
export async function addPortMapping(igd: Igd, port: number, protocol: PortProtocol, description: string, leaseSeconds: number): Promise<void> {
  const args = (lease: number): Record<string, string | number> => ({
    NewRemoteHost: '',
    NewExternalPort: port,
    NewProtocol: protocol,
    NewInternalPort: port,
    NewInternalClient: igd.localAddress,
    NewEnabled: 1,
    NewPortMappingDescription: description,
    NewLeaseDuration: lease
  })
  try {
    await soap(igd, 'AddPortMapping', args(leaseSeconds))
  } catch (err) {
    if (!/725/.test((err as Error).message)) throw err
    await soap(igd, 'AddPortMapping', args(0))
  }
}

export async function deletePortMapping(igd: Igd, port: number, protocol: PortProtocol): Promise<void> {
  await soap(igd, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: protocol })
}
