import { randomBytes, randomInt, timingSafeEqual, createHash } from 'node:crypto'
import { MAX_PIN_ATTEMPTS, PIN_LOCKOUT_MS, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../shared/constants'

export function clampPinLength(length: number): number {
  if (!Number.isFinite(length)) return PIN_MAX_LENGTH
  return Math.min(PIN_MAX_LENGTH, Math.max(PIN_MIN_LENGTH, Math.round(length)))
}

/** Uniformly random numeric PIN (leading zeros allowed). */
export function generatePin(length = PIN_MAX_LENGTH): string {
  const len = clampPinLength(length)
  let pin = ''
  for (let i = 0; i < len; i++) pin += randomInt(0, 10).toString()
  return pin
}

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin)
}

/** Constant-time PIN comparison (hashing equalises lengths). */
export function pinsEqual(expected: string, provided: string): boolean {
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(provided).digest()
  return timingSafeEqual(a, b)
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}

export function randomId(): string {
  return randomBytes(8).toString('hex')
}

export interface PinCheckResult {
  ok: boolean
  locked: boolean
  attemptsLeft: number
  retryAfterMs: number
}

/**
 * Tracks failed PIN attempts per remote address and locks an address out
 * for `lockoutMs` after `maxAttempts` consecutive failures.
 */
export class PinGuard {
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>()

  constructor(
    private readonly maxAttempts = MAX_PIN_ATTEMPTS,
    private readonly lockoutMs = PIN_LOCKOUT_MS,
    private readonly now: () => number = Date.now
  ) {}

  lockRemaining(key: string): number {
    const entry = this.failures.get(key)
    if (!entry) return 0
    const remaining = entry.lockedUntil - this.now()
    return remaining > 0 ? remaining : 0
  }

  /** Validate `provided` against `expected` for the remote identified by `key`. */
  check(key: string, expected: string, provided: string | undefined): PinCheckResult {
    const lockedFor = this.lockRemaining(key)
    if (lockedFor > 0) return { ok: false, locked: true, attemptsLeft: 0, retryAfterMs: lockedFor }

    if (typeof provided === 'string' && isValidPin(provided) && pinsEqual(expected, provided)) {
      this.failures.delete(key)
      return { ok: true, locked: false, attemptsLeft: this.maxAttempts, retryAfterMs: 0 }
    }

    const entry = this.failures.get(key) ?? { count: 0, lockedUntil: 0 }
    if (entry.lockedUntil !== 0 && entry.lockedUntil <= this.now()) entry.count = 0
    entry.count++
    entry.lockedUntil = 0
    if (entry.count >= this.maxAttempts) {
      entry.lockedUntil = this.now() + this.lockoutMs
      this.failures.set(key, entry)
      return { ok: false, locked: true, attemptsLeft: 0, retryAfterMs: this.lockoutMs }
    }
    this.failures.set(key, entry)
    return { ok: false, locked: false, attemptsLeft: this.maxAttempts - entry.count, retryAfterMs: 0 }
  }

  /** Forget all failures, e.g. when the host sets a new PIN. */
  reset(): void {
    this.failures.clear()
  }
}
