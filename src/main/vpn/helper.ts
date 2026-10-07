import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { VPN_MTU } from '../../shared/constants'

/** Where the VPN helper (native/ssvpn, built by scripts/build-vpn.cjs) is, and how to call it. */

export interface HelperLocation {
  /** Packaged app: the resources folder holds ssvpn (and wintun.dll on Windows). */
  packaged: boolean
  resourcesPath: string
  appPath: string
  platform: NodeJS.Platform
  arch: string
}

/** The helper's path, or null when this build doesn't have one for this platform. */
export function findHelper(where: HelperLocation): string | null {
  const exe = where.platform === 'win32' ? 'ssvpn.exe' : 'ssvpn'
  const file = where.packaged
    ? path.join(where.resourcesPath, exe)
    : path.join(where.appPath, 'native', 'bin', `${where.platform}-${where.arch}`, exe)
  if (!fs.existsSync(file)) return null
  // Wintun's driver library sits next to the helper and is loaded from there.
  if (where.platform === 'win32' && !fs.existsSync(path.join(path.dirname(file), 'wintun.dll'))) return null
  return file
}

/**
 * The helper runs with administrator rights, so it must be exactly what was shipped.
 * A packaged build lists the SHA-256 of each file (`vpn-helper.json`, made at build
 * time); this refuses to start anything that doesn't match, right before asking for
 * the password, so a swapped file never gets elevated.
 */
export function verifyHelper(file: string, expected: Record<string, string> | null): void {
  if (expected === null) return // a development build: the helper is whatever you just built
  for (const name of [path.basename(file), ...(process.platform === 'win32' ? ['wintun.dll'] : [])]) {
    const want = expected[name]
    const have = createHash('sha256').update(fs.readFileSync(path.join(path.dirname(file), name))).digest('hex')
    if (!want || want !== have) throw new Error(`The Remote helper (${name}) is not the one that came with ScreenShare, so it was not started`)
  }
}

/** Reads the checksums that came with the app, or null outside a packaged build. */
export function readHelperChecksums(where: HelperLocation): Record<string, string> | null {
  if (!where.packaged) return null
  try {
    return JSON.parse(fs.readFileSync(path.join(where.resourcesPath, 'vpn-helper.json'), 'utf8')) as Record<string, string>
  } catch {
    return {} // packaged but no list: nothing will verify, so nothing is elevated
  }
}

export interface HelperArguments {
  name: string
  address: string
  prefix: number
  /** Who may use the control socket: a user id, or a SID on Windows. */
  owner: string
  parentPid: number
  aliveFile: string
  statusFile: string
  forward: boolean
}

export function helperArguments(a: HelperArguments): string[] {
  return [
    'up',
    '--name', a.name,
    '--address', a.address,
    '--prefix', String(a.prefix),
    '--mtu', String(VPN_MTU),
    '--owner', a.owner,
    '--parent', String(a.parentPid),
    '--alive', a.aliveFile,
    '--status', a.statusFile,
    ...(a.forward ? ['--forward'] : [])
  ]
}

/** What the helper writes to the status file. */
export interface HelperStatus {
  interface?: string
  socket?: string
  error?: string
}

export function parseHelperStatus(text: string): HelperStatus | null {
  try {
    const v = JSON.parse(text) as HelperStatus
    if (typeof v.error === 'string') return { error: v.error }
    if (typeof v.interface === 'string' && typeof v.socket === 'string') return { interface: v.interface, socket: v.socket }
  } catch {
    // not complete yet
  }
  return null
}

/** The SID in the CSV that `whoami /user /fo csv /nh` prints: "DOMAIN\user","S-1-5-21-…". */
export function parseWhoamiSid(output: string): string | null {
  const match = /"(S-1-[0-9]+(?:-[0-9]+){1,15})"/.exec(output)
  return match ? match[1] : null
}
