import { describe, expect, it } from 'vitest'
import { clampPinLength, generatePin, isValidPin, PinGuard, pinsEqual } from '../src/utils/crypto'

describe('PIN helpers', () => {
  it('generates numeric PINs of the requested (clamped) length', () => {
    for (const len of [4, 5, 6]) {
      const pin = generatePin(len)
      expect(pin).toMatch(new RegExp(`^\\d{${len}}$`))
    }
    expect(generatePin(2)).toHaveLength(4)
    expect(generatePin(10)).toHaveLength(6)
    expect(clampPinLength(NaN)).toBe(6)
  })

  it('validates PIN format', () => {
    expect(isValidPin('1234')).toBe(true)
    expect(isValidPin('123456')).toBe(true)
    expect(isValidPin('123')).toBe(false)
    expect(isValidPin('1234567')).toBe(false)
    expect(isValidPin('12a4')).toBe(false)
    expect(isValidPin(1234)).toBe(false)
  })

  it('compares PINs of different lengths safely', () => {
    expect(pinsEqual('1234', '1234')).toBe(true)
    expect(pinsEqual('1234', '12345')).toBe(false)
    expect(pinsEqual('1234', '')).toBe(false)
  })
})

describe('PinGuard', () => {
  it('locks an address after the max failed attempts and unlocks after the timeout', () => {
    let now = 0
    const guard = new PinGuard(3, 1000, () => now)
    expect(guard.check('a', '1111', '0000')).toMatchObject({ ok: false, locked: false, attemptsLeft: 2 })
    expect(guard.check('a', '1111', '0000')).toMatchObject({ ok: false, locked: false, attemptsLeft: 1 })
    expect(guard.check('a', '1111', '0000')).toMatchObject({ ok: false, locked: true })
    expect(guard.check('a', '1111', '1111')).toMatchObject({ ok: false, locked: true, retryAfterMs: 1000 })
    // Other addresses are unaffected.
    expect(guard.check('b', '1111', '1111').ok).toBe(true)
    now = 1001
    expect(guard.check('a', '1111', '1111').ok).toBe(true)
  })

  it('resets the failure count after a success', () => {
    const guard = new PinGuard(3, 1000)
    guard.check('a', '1111', '0000')
    guard.check('a', '1111', '0000')
    expect(guard.check('a', '1111', '1111').ok).toBe(true)
    expect(guard.check('a', '1111', '0000').attemptsLeft).toBe(2)
  })
})
