import { describe, expect, it } from 'vitest'
import { decodeTimeCode, encodeTimeCode, TIME_CODE, timeCodeAge, timeCodeCellCentre } from '../src/shared/timeCode'

describe('time code', () => {
  it('fills every cell and reads back the time it was drawn with', () => {
    expect(encodeTimeCode(0)).toHaveLength(TIME_CODE.columns * TIME_CODE.rows)
    for (const ms of [0, 1, 1_791_639_052_928, 2 ** 32 - 1, 123_456.7]) {
      expect(decodeTimeCode(encodeTimeCode(ms))).toBe(Math.floor(ms) >>> 0)
    }
  })

  it('rejects all-black, all-white and damaged codes', () => {
    const cells = TIME_CODE.columns * TIME_CODE.rows
    expect(decodeTimeCode(Array(cells).fill(false))).toBeNull()
    expect(decodeTimeCode(Array(cells).fill(true))).toBeNull()
    const bits = encodeTimeCode(1_791_639_052_928)
    for (const i of [0, 7, 31, 35]) {
      const damaged = [...bits]
      damaged[i] = !damaged[i]
      expect(decodeTimeCode(damaged)).toBeNull()
    }
    expect(decodeTimeCode(bits.slice(1))).toBeNull()
  })

  it('measures the age of a code across the 32-bit wrap', () => {
    const drawn = 2 ** 32 * 417 - 10
    const code = decodeTimeCode(encodeTimeCode(drawn))!
    expect(timeCodeAge(drawn + 42, code)).toBe(42)
    expect(timeCodeAge(1_791_639_052_970, decodeTimeCode(encodeTimeCode(1_791_639_052_928))!)).toBe(42)
  })

  it('samples the middle of each cell, row by row', () => {
    const { cell, x, y, columns } = TIME_CODE
    expect(timeCodeCellCentre(0)).toEqual({ x: x + cell / 2, y: y + cell / 2 })
    expect(timeCodeCellCentre(columns)).toEqual({ x: x + cell / 2, y: y + cell + cell / 2 })
  })
})
