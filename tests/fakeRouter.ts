import dgram from 'node:dgram'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

/** A router that speaks UPnP on loopback: answers the SSDP search and the SOAP calls, and records what it was asked. */
export class FakeRouter {
  readonly mappings = new Map<string, { internalClient: string; lease: number }>()
  readonly actions: string[] = []
  externalAddress = '203.0.113.9'
  /** UPnP error code to answer AddPortMapping with (e.g. 725: only permanent leases). */
  failAddWith: number | null = null
  /** Refuse leases other than 0, like routers answering 725. */
  permanentOnly = false
  /** Answer the search with a description at this address instead of our own (a stranger pointing us elsewhere). */
  locationHost = '127.0.0.1'
  private udp = dgram.createSocket('udp4')
  private web: http.Server

  ssdpPort = 0
  private webPort = 0

  constructor(private readonly serviceType = 'urn:schemas-upnp-org:service:WANIPConnection:1') {
    this.web = http.createServer((req, res) => this.handle(req, res))
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.web.listen(0, '127.0.0.1', resolve))
    this.webPort = (this.web.address() as AddressInfo).port
    this.udp.on('message', (_msg, rinfo) => {
      const reply = `HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\nLOCATION: http://${this.locationHost}:${this.webPort}/desc.xml\r\nST: upnp:rootdevice\r\n\r\n`
      this.udp.send(reply, rinfo.port, rinfo.address)
    })
    await new Promise<void>((resolve) => this.udp.bind(0, '127.0.0.1', resolve))
    this.ssdpPort = this.udp.address().port
  }

  async stop(): Promise<void> {
    this.udp.close()
    await new Promise<void>((resolve) => {
      this.web.close(() => resolve())
      this.web.closeAllConnections()
    })
  }

  get ssdp(): { address: string; port: number } {
    return { address: '127.0.0.1', port: this.ssdpPort }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === 'GET' && req.url === '/desc.xml') {
      res.writeHead(200, { 'content-type': 'text/xml' })
      res.end(`<?xml version="1.0"?><root><device><deviceList><device><deviceList><device><serviceList>
        <service><serviceType>urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1</serviceType><controlURL>/common</controlURL></service>
        <service><serviceType>${this.serviceType}</serviceType><controlURL>/ctl/IPConn</controlURL></service>
        </serviceList></device></deviceList></device></deviceList></device></root>`)
      return
    }
    if (req.method === 'POST' && req.url === '/ctl/IPConn') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => this.soap(String(req.headers.soapaction ?? ''), body, res))
      return
    }
    res.writeHead(404).end()
  }

  private soap(header: string, body: string, res: http.ServerResponse): void {
    const action = /#(\w+)"/.exec(header)?.[1] ?? ''
    this.actions.push(action)
    const field = (name: string): string => new RegExp(`<${name}>([^<]*)</${name}>`).exec(body)?.[1] ?? ''
    const reply = (status: number, xml: string): void => {
      res.writeHead(status, { 'content-type': 'text/xml' })
      res.end(`<?xml version="1.0"?><s:Envelope xmlns:s="x"><s:Body>${xml}</s:Body></s:Envelope>`)
    }
    const fault = (code: number): void =>
      reply(500, `<s:Fault><detail><UPnPError><errorCode>${code}</errorCode></UPnPError></detail></s:Fault>`)
    if (action === 'GetExternalIPAddress') {
      return reply(200, `<u:GetExternalIPAddressResponse><NewExternalIPAddress>${this.externalAddress}</NewExternalIPAddress></u:GetExternalIPAddressResponse>`)
    }
    if (action === 'AddPortMapping') {
      const lease = Number(field('NewLeaseDuration'))
      if (this.failAddWith !== null) return fault(this.failAddWith)
      if (this.permanentOnly && lease !== 0) return fault(725)
      this.mappings.set(`${field('NewProtocol')}:${field('NewExternalPort')}`, { internalClient: field('NewInternalClient'), lease })
      return reply(200, '<u:AddPortMappingResponse/>')
    }
    if (action === 'DeletePortMapping') {
      const key = `${field('NewProtocol')}:${field('NewExternalPort')}`
      return this.mappings.delete(key) ? reply(200, '<u:DeletePortMappingResponse/>') : fault(714)
    }
    fault(401)
  }
}
