/**
 * A clock reading drawn as black and white blocks, for measuring real
 * screen-to-screen latency (`npm run perf -- --latency`): a test pattern on
 * the shared screen draws the time each frame is drawn, and a viewer on the
 * same computer (same clock) reads it back from the video when that frame is
 * shown. Pure, so the pattern, the reader and the tests share it.
 *
 * Layout: COLUMNS × ROWS square cells, row by row, white = 1. The first 32
 * cells hold the time in ms modulo 2^32 (most significant bit first), the
 * last 8 a checksum, so a frame caught half-drawn, blurred or covered is
 * rejected instead of read wrong.
 */
export const TIME_CODE = {
  /** Cell size and top-left corner, in pixels of the shared screen. */
  cell: 24,
  x: 24,
  y: 24,
  columns: 20,
  rows: 2
} as const

const DATA_BITS = 32
const CHECK_BITS = 8
/** Keeps an all-black (or all-white) frame from passing the checksum. */
const CHECK_SALT = 0xa5

function checksum(value: number): number {
  const sum = (value & 0xff) + ((value >>> 8) & 0xff) + ((value >>> 16) & 0xff) + ((value >>> 24) & 0xff)
  return (sum & 0xff) ^ CHECK_SALT
}

/** The cells for a time in ms (only its low 32 bits are kept). */
export function encodeTimeCode(ms: number): boolean[] {
  const value = Math.floor(ms) >>> 0
  const bits: boolean[] = []
  for (let i = DATA_BITS - 1; i >= 0; i--) bits.push(((value >>> i) & 1) === 1)
  const check = checksum(value)
  for (let i = CHECK_BITS - 1; i >= 0; i--) bits.push(((check >>> i) & 1) === 1)
  return bits
}

/** The time read from the cells (low 32 bits of ms), or null when the checksum doesn't match. */
export function decodeTimeCode(bits: readonly boolean[]): number | null {
  if (bits.length !== DATA_BITS + CHECK_BITS) return null
  let value = 0
  for (let i = 0; i < DATA_BITS; i++) value = ((value << 1) | (bits[i] ? 1 : 0)) >>> 0
  let check = 0
  for (let i = DATA_BITS; i < DATA_BITS + CHECK_BITS; i++) check = (check << 1) | (bits[i] ? 1 : 0)
  return check === checksum(value) ? value : null
}

/**
 * How long ago (ms) a code was drawn, seen at `nowMs`, across the code's wrap. Negative when the
 * code looks newer than `nowMs`, which can only be a misread (the reader counts it as unreadable).
 */
export function timeCodeAge(nowMs: number, code: number): number {
  const age = ((Math.floor(nowMs) >>> 0) - code + 2 ** 32) % 2 ** 32
  return age >= 2 ** 31 ? age - 2 ** 32 : age
}

/** Where to sample cell `index`: its centre, in pixels of the shared screen. */
export function timeCodeCellCentre(index: number): { x: number; y: number } {
  const { cell, x, y, columns } = TIME_CODE
  return { x: x + (index % columns) * cell + cell / 2, y: y + Math.floor(index / columns) * cell + cell / 2 }
}
