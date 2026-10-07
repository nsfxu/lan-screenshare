import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { uapiRemovePeer, uapiRequest, uapiSetDevice, uapiSetPeer } from '../src/utils/wireguard'

const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='
const PEER = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8='
const KEY_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const PEER_HEX = '202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f'

describe('wireguard-go requests', () => {
  it('configures the device with keys in hex and ends with a blank line', () => {
    const text = uapiSetDevice({ privateKey: KEY, listenPort: 47800 }, [
      { publicKey: PEER, allowedIps: ['10.77.5.0/24'], endpoint: 'example.org:47800', keepalive: 25 }
    ])
    expect(text).toBe(
      [
        'set=1',
        `private_key=${KEY_HEX}`,
        'listen_port=47800',
        'replace_peers=true',
        `public_key=${PEER_HEX}`,
        'replace_allowed_ips=true',
        'endpoint=example.org:47800',
        'persistent_keepalive_interval=25',
        'allowed_ip=10.77.5.0/24',
        '',
        ''
      ].join('\n')
    )
  })

  it('does not carry the key in base64 anywhere', () => {
    expect(uapiSetDevice({ privateKey: KEY }, [])).not.toContain(KEY)
  })

  it('adds and removes one peer', () => {
    expect(uapiSetPeer({ publicKey: PEER, allowedIps: ['10.77.5.2/32'] })).toBe(
      `set=1\npublic_key=${PEER_HEX}\nreplace_allowed_ips=true\nallowed_ip=10.77.5.2/32\n\n`
    )
    expect(uapiRemovePeer(PEER)).toBe(`set=1\npublic_key=${PEER_HEX}\nremove=true\n\n`)
  })
})

describe('uapiRequest', () => {
  let dir: string | null = null
  let server: net.Server | null = null

  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(null)))
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
    server = dir = null
  })

  async function fakeWireGuard(answer: string): Promise<{ socket: string; received: string[] }> {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uapi-test-'))
    const socket = path.join(dir, 'wg.sock')
    const received: string[] = []
    server = net.createServer((conn) => {
      let data = ''
      conn.on('data', (chunk) => {
        data += chunk.toString()
        if (!data.endsWith('\n\n')) return
        received.push(data)
        conn.end(answer)
      })
    })
    await new Promise<void>((resolve) => server!.listen(socket, resolve))
    return { socket, received }
  }

  it('sends the request and accepts errno=0', async () => {
    const { socket, received } = await fakeWireGuard('errno=0\n\n')
    await uapiRequest(socket, uapiRemovePeer(PEER))
    expect(received).toEqual([uapiRemovePeer(PEER)])
  })

  it('fails when wireguard refuses', async () => {
    const { socket } = await fakeWireGuard('errno=22\n\n')
    await expect(uapiRequest(socket, uapiRemovePeer(PEER))).rejects.toThrow(/errno 22/)
  })

  it('fails when there is no socket', async () => {
    await expect(uapiRequest(path.join(os.tmpdir(), 'no-such-wireguard.sock'), 'set=1\n\n')).rejects.toThrow()
  })
})
