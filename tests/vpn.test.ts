import { describe, expect, it } from 'vitest'
import type { VpnInvite } from '../src/shared/types'
import {
  AddressPool,
  decodeInvite,
  encodeInvite,
  isIPv4,
  isWireGuardKey,
  keyToHex,
  overlapsNetwork,
  parseEnrollRequest,
  parseEnrollResponse,
  pickNetwork
} from '../src/shared/vpn'
import { generateKeyPair } from '../src/utils/wireguard'

const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='
const OTHER_KEY = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8='

const invite: VpnInvite = {
  endpoint: 'home.example.org',
  port: 47800,
  tls: true,
  fingerprint: 'sha256/' + 'A'.repeat(43) + '=',
  hostKey: KEY,
  hostAddress: '10.77.5.1',
  secret: 'abcdefghijklmnopqrstuvwxyz012345'
}

describe('keys and addresses', () => {
  it('recognises WireGuard keys', () => {
    expect(isWireGuardKey(KEY)).toBe(true)
    expect(isWireGuardKey(KEY.slice(1))).toBe(false)
    expect(isWireGuardKey('x'.repeat(44))).toBe(false)
    expect(isWireGuardKey(42)).toBe(false)
  })

  it('converts a key to the hex WireGuard speaks', () => {
    expect(keyToHex(KEY)).toBe('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
  })

  it('generates real key pairs', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    expect(isWireGuardKey(a.privateKey)).toBe(true)
    expect(isWireGuardKey(a.publicKey)).toBe(true)
    expect(a.publicKey).not.toBe(b.publicKey)
    expect(a.privateKey).not.toBe(a.publicKey)
  })

  it('validates IPv4 literals strictly', () => {
    expect(isIPv4('10.77.5.1')).toBe(true)
    for (const bad of ['10.77.5', '10.77.5.256', '10.077.5.1', '10.77.5.1.2', 'a.b.c.d', '', 5]) expect(isIPv4(bad)).toBe(false)
  })
})

describe('picking a network', () => {
  it('stays inside 10.77.x.0/24', () => {
    expect(pickNetwork([], () => 0)).toBe('10.77.1')
    expect(pickNetwork([], () => 0.999999)).toBe('10.77.254')
  })

  it('never picks a network this computer is already on', () => {
    const local = ['10.77.1.20', '10.77.2.5', '192.168.1.4']
    expect(pickNetwork(local, () => 0)).toBe('10.77.3')
    expect(overlapsNetwork('10.77.1', local)).toBe(true)
    expect(overlapsNetwork('10.77.9', local)).toBe(false)
  })
})

describe('AddressPool', () => {
  it('hands out .2 and up, and the same guest keeps its address', () => {
    const pool = new AddressPool('10.77.5')
    expect(pool.assign('a')).toBe('10.77.5.2')
    expect(pool.assign('b')).toBe('10.77.5.3')
    expect(pool.assign('a')).toBe('10.77.5.2')
    expect(pool.size).toBe(2)
  })

  it('reuses a released address and says when it is full', () => {
    const pool = new AddressPool('10.77.5', 2)
    pool.assign('a')
    pool.assign('b')
    expect(pool.assign('c')).toBeNull()
    pool.release('a')
    expect(pool.assign('c')).toBe('10.77.5.2')
  })
})

describe('invites', () => {
  it('round-trips', () => {
    const text = encodeInvite(invite)
    expect(text.startsWith('ssvpn1.')).toBe(true)
    expect(text).not.toMatch(/\s/)
    expect(decodeInvite(`  ${text}\n`)).toEqual(invite)
  })

  it('round-trips an invite without TLS', () => {
    const plain = { ...invite, tls: false, fingerprint: null }
    expect(decodeInvite(encodeInvite(plain))).toEqual(plain)
  })

  it('rejects anything that is not a well-formed invite', () => {
    const bad: unknown[] = [
      'hello',
      'ssvpn1.',
      'ssvpn1.!!!',
      encodeInvite({ ...invite, hostKey: 'nope' }),
      encodeInvite({ ...invite, port: 70000 }),
      encodeInvite({ ...invite, endpoint: 'bad host/' }),
      encodeInvite({ ...invite, secret: 'short' }),
      encodeInvite({ ...invite, hostAddress: '10.77.5' }),
      encodeInvite({ ...invite, fingerprint: null }), // TLS without a fingerprint to pin
      encodeInvite({ ...invite, fingerprint: 'sha1/xx' })
    ]
    for (const text of bad) expect(decodeInvite(text as string)).toBeNull()
  })
})

describe('enrolment messages', () => {
  const good = { secret: 'x', publicKey: KEY, clientId: 'client_1-A' }

  it('accepts a well-formed request', () => {
    expect(parseEnrollRequest(good)).toEqual(good)
  })

  it('rejects malformed requests', () => {
    for (const bad of [null, 'x', {}, { ...good, secret: '' }, { ...good, publicKey: 'k' }, { ...good, clientId: 'a b' }, { ...good, clientId: '' }]) {
      expect(parseEnrollRequest(bad)).toBeNull()
    }
  })

  const answer = { address: '10.77.5.2', hostAddress: '10.77.5.1', prefix: 24, hostKey: KEY, port: 47800 }

  it('accepts the answer its invite predicts', () => {
    expect(parseEnrollResponse(answer, invite)).toEqual(answer)
  })

  it('refuses an answer that does not match the invite', () => {
    for (const bad of [
      { ...answer, hostKey: OTHER_KEY },
      { ...answer, hostAddress: '10.77.5.9' },
      { ...answer, address: '10.77.6.2' }, // another network
      { ...answer, address: '10.77.5.1' }, // the host's own address
      { ...answer, prefix: 8 },
      { ...answer, port: 1 },
      null
    ]) {
      expect(parseEnrollResponse(bad, invite)).toBeNull()
    }
  })
})
