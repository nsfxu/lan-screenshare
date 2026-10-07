import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appleScriptString, psQuote, shQuote, windowsArgumentString } from '../src/main/vpn/elevate'
import { findHelper, helperArguments, parseHelperStatus, parseWhoamiSid, readHelperChecksums, verifyHelper } from '../src/main/vpn/helper'

let dir: string | null = null
function temp(): string {
  return (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-test-')))
}
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = null
})
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

describe('finding the helper', () => {
  it('looks in native/bin/<platform>-<arch> in development', () => {
    const app = temp()
    const folder = path.join(app, 'native', 'bin', 'darwin-arm64')
    fs.mkdirSync(folder, { recursive: true })
    const where = { packaged: false, resourcesPath: '', appPath: app, platform: 'darwin' as const, arch: 'arm64' }
    expect(findHelper(where)).toBeNull()
    fs.writeFileSync(path.join(folder, 'ssvpn'), '')
    expect(findHelper(where)).toBe(path.join(folder, 'ssvpn'))
    expect(findHelper({ ...where, arch: 'x64' })).toBeNull()
  })

  it('looks in the resources folder when packaged, and on Windows needs wintun.dll beside it', () => {
    const resources = temp()
    const where = { packaged: true, resourcesPath: resources, appPath: '', platform: 'win32' as const, arch: 'x64' }
    fs.writeFileSync(path.join(resources, 'ssvpn.exe'), '')
    expect(findHelper(where)).toBeNull()
    fs.writeFileSync(path.join(resources, 'wintun.dll'), '')
    expect(findHelper(where)).toBe(path.join(resources, 'ssvpn.exe'))
  })
})

describe('checking the helper before it gets administrator rights', () => {
  it('accepts the files that were shipped and refuses a swapped one', () => {
    const folder = temp()
    const file = path.join(folder, 'ssvpn')
    fs.writeFileSync(file, 'original')
    const shipped = { ssvpn: sha('original'), 'wintun.dll': sha('dll') }
    if (process.platform === 'win32') fs.writeFileSync(path.join(folder, 'wintun.dll'), 'dll')
    expect(() => verifyHelper(file, shipped)).not.toThrow()
    fs.writeFileSync(file, 'swapped')
    expect(() => verifyHelper(file, shipped)).toThrow(/not the one that came with ScreenShare/)
  })

  it('refuses a file nobody listed, and a packaged build with no list at all', () => {
    const folder = temp()
    const file = path.join(folder, 'ssvpn')
    fs.writeFileSync(file, 'x')
    expect(() => verifyHelper(file, {})).toThrow()
    const where = { packaged: true, resourcesPath: folder, appPath: '', platform: 'linux' as const, arch: 'x64' }
    expect(readHelperChecksums(where)).toEqual({})
    fs.writeFileSync(path.join(folder, 'vpn-helper.json'), JSON.stringify({ ssvpn: sha('x') }))
    expect(() => verifyHelper(file, readHelperChecksums(where))).not.toThrow()
  })

  it('trusts the local build in development', () => {
    expect(readHelperChecksums({ packaged: false, resourcesPath: '', appPath: '', platform: 'linux', arch: 'x64' })).toBeNull()
    expect(() => verifyHelper('/anything', null)).not.toThrow()
  })
})

describe('helper protocol', () => {
  it('builds the command line the helper validates', () => {
    expect(
      helperArguments({ name: 'ssvpn0', address: '10.77.5.1', prefix: 24, owner: '501', parentPid: 99, aliveFile: '/t/alive', statusFile: '/t/status', forward: true })
    ).toEqual(['up', '--name', 'ssvpn0', '--address', '10.77.5.1', '--prefix', '24', '--mtu', '1380', '--owner', '501', '--parent', '99', '--alive', '/t/alive', '--status', '/t/status', '--forward'])
    expect(
      helperArguments({ name: 'a', address: '10.77.5.2', prefix: 24, owner: '1', parentPid: 1, aliveFile: '/a', statusFile: '/s', forward: false })
    ).not.toContain('--forward')
  })

  it('reads the status file only when it is complete', () => {
    expect(parseHelperStatus('{"interface":"utun7","socket":"/var/run/wireguard/utun7.sock"}')).toEqual({ interface: 'utun7', socket: '/var/run/wireguard/utun7.sock' })
    expect(parseHelperStatus('{"error":"no permission"}')).toEqual({ error: 'no permission' })
    expect(parseHelperStatus('{"interface":"utun7"')).toBeNull()
    expect(parseHelperStatus('{}')).toBeNull()
  })

  it('finds the SID in whoami output', () => {
    expect(parseWhoamiSid('"DESKTOP\\ana","S-1-5-21-1004336348-1177238915-682003330-1001"\r\n')).toBe('S-1-5-21-1004336348-1177238915-682003330-1001')
    expect(parseWhoamiSid('nothing')).toBeNull()
  })
})

describe('quoting for the permission prompts', () => {
  it('single-quotes for sh whatever the value holds', () => {
    for (const value of ['plain', "it's", 'a "b" $(c) `d` \\e', 'two words', '']) {
      expect(spawnSync('/bin/sh', ['-c', `printf %s ${shQuote(value)}`]).stdout.toString()).toBe(value)
    }
  })

  it('escapes AppleScript, PowerShell and Windows command lines', () => {
    expect(appleScriptString('say "hi" \\ there')).toBe('"say \\"hi\\" \\\\ there"')
    expect(psQuote("C:\\Program Files\\it's")).toBe("'C:\\Program Files\\it''s'")
    expect(windowsArgumentString(['up', 'C:\\Program Files\\x', 'a"b'])).toBe('"up" "C:\\Program Files\\x" "a\\"b"')
  })
})
