import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { VPN_KEEPALIVE_SECONDS } from '../../shared/constants'
import { uapiRequest, uapiRemovePeer, uapiSetDevice, uapiSetPeer, type UapiPeer } from '../../utils/wireguard'
import { startElevated } from './elevate'
import { helperArguments, parseHelperStatus, parseWhoamiSid, verifyHelper, type HelperStatus } from './helper'

export interface TunnelConfig {
  /** This computer's address inside the VPN. */
  address: string
  prefix: number
  /** WireGuard private key (base64): kept in memory, sent to the helper over its control socket. */
  privateKey: string
  /** UDP port to listen on (the host); guests dial out and need none. */
  listenPort?: number
  peers: UapiPeer[]
  /** Relay packets between peers (the host does). */
  forward: boolean
}

/** A virtual network interface running WireGuard. */
export interface VpnTunnel {
  up(config: TunnelConfig): Promise<{ interface: string }>
  setPeer(peer: UapiPeer): Promise<void>
  removePeer(publicKey: string): Promise<void>
  /** Takes the interface down. Safe to call twice. */
  down(): Promise<void>
}

/** How long to wait for the user to answer the permission prompt, and for the helper to report. */
const START_TIMEOUT_MS = 180_000

/**
 * The real tunnel: the bundled `ssvpn` helper, started with administrator rights
 * (one permission prompt), then driven by the app over its control socket.
 */
export class SystemTunnel implements VpnTunnel {
  private socket: string | null = null
  private dir: string | null = null

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly helper: string,
    /** SHA-256 of the helper's files from the build, or null for a development build (see verifyHelper). */
    private readonly checksums: Record<string, string> | null
  ) {}

  async up(config: TunnelConfig): Promise<{ interface: string }> {
    if (this.socket) throw new Error('Remote is already connected')
    verifyHelper(this.helper, this.checksums)
    const dir = (this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshare-vpn-')))
    const aliveFile = path.join(dir, 'alive')
    const statusFile = path.join(dir, 'status')
    fs.writeFileSync(aliveFile, '')
    try {
      const elevated = await startElevated(
        this.platform,
        this.helper,
        helperArguments({
          name: 'ssvpn0',
          address: config.address,
          prefix: config.prefix,
          owner: await ownerOf(this.platform),
          parentPid: process.pid,
          aliveFile,
          statusFile,
          forward: config.forward
        })
      )
      const status = await Promise.race([
        waitForStatus(statusFile),
        elevated.exited.then((code): never => {
          throw new Error(`The Remote helper stopped (exit ${code ?? 'unknown'})`)
        })
      ])
      if (status.error || !status.socket || !status.interface) throw new Error(status.error ?? 'The Remote helper did not start')
      this.socket = status.socket
      await uapiRequest(status.socket, uapiSetDevice({ privateKey: config.privateKey, listenPort: config.listenPort }, config.peers))
      return { interface: status.interface }
    } catch (err) {
      await this.down()
      throw err
    }
  }

  setPeer(peer: UapiPeer): Promise<void> {
    return uapiRequest(this.control(), uapiSetPeer({ keepalive: VPN_KEEPALIVE_SECONDS, ...peer })).then(() => undefined)
  }

  removePeer(publicKey: string): Promise<void> {
    return uapiRequest(this.control(), uapiRemovePeer(publicKey)).then(() => undefined)
  }

  async down(): Promise<void> {
    const dir = this.dir
    const socket = this.socket
    this.dir = this.socket = null
    if (dir) fs.rmSync(dir, { recursive: true, force: true }) // the helper notices and undoes everything
    // Give it a moment, so the next VPN doesn't race the old interface (Windows pipes have no file to watch).
    if (socket && this.platform !== 'win32') {
      for (let i = 0; i < 40 && fs.existsSync(socket); i++) await new Promise((r) => setTimeout(r, 250))
    }
  }

  private control(): string {
    if (!this.socket) throw new Error('Remote is not connected')
    return this.socket
  }
}

async function waitForStatus(file: string): Promise<HelperStatus> {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const status = parseHelperStatus(fs.readFileSync(file, 'utf8'))
      if (status) return status
    } catch {
      // not written yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('The Remote helper did not report back in time')
}

/** Who gets the control socket: our user id, or on Windows our SID (the elevated helper may be another account). */
async function ownerOf(platform: NodeJS.Platform): Promise<string> {
  if (platform !== 'win32') return String(process.getuid?.() ?? 0)
  const output = await new Promise<string>((resolve, reject) =>
    execFile('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  )
  const sid = parseWhoamiSid(output)
  if (!sid) throw new Error('Could not find out who you are on this computer')
  return sid
}
