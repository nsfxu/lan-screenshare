import http from 'node:http'
import https from 'node:https'
import { isPublicIPv4 } from '../shared/vpn'

/** The one outside service VPN rooms use, only when you ask to open one: it answers with the address your request came from. */
export const PUBLIC_IP_URL = 'https://api.ipify.org'

/** Our address as the internet sees it, or null when it can't be told (offline, blocked). */
export function fetchPublicAddress(url: string = PUBLIC_IP_URL, timeoutMs = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    let body = ''
    const req = (url.startsWith('http:') ? http : https).get(url, { timeout: timeoutMs, headers: { accept: 'text/plain' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        return resolve(null)
      }
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        body += chunk
        if (body.length > 64) req.destroy()
      })
      res.on('end', () => resolve(isPublicIPv4(body.trim()) ? body.trim() : null))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })
}
