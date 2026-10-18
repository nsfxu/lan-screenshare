import { describe, expect, it } from 'vitest'
import {
  contentRect,
  isStrokeId,
  MARK_FADE_MS,
  MARK_HOLD_MS,
  MarksBoard,
  POINTER_IDLE_MS,
  RateWindow,
  STROKE_MAX_POINTS,
  STROKE_TOTAL_POINTS,
  strokeOpacity,
  strokePoints,
  toUnit
} from '../src/shared/marks'

describe('marks: what the server accepts', () => {
  it('takes stroke pieces of 0–1 points, up to the limit', () => {
    expect(strokePoints([0, 0, 0.5, 1])).toEqual([0, 0, 0.5, 1])
    expect(strokePoints(new Array(STROKE_MAX_POINTS * 2).fill(0.5))).not.toBeNull()
    for (const bad of [[], [0.5], [0, 0, 1], [0, 1.1], [-0.1, 0], [0, NaN], ['0', 0], null, 'x', new Array(STROKE_MAX_POINTS * 2 + 2).fill(0)]) {
      expect(strokePoints(bad)).toBeNull()
    }
  })

  it('takes short word-like stroke ids only', () => {
    expect(isStrokeId('a1-b2')).toBe(true)
    for (const bad of ['', 'x'.repeat(17), 'a b', '<i>', 3, null]) expect(isStrokeId(bad)).toBe(false)
  })

  it('limits events per second in a sliding window', () => {
    const rate = new RateWindow(3)
    expect([0, 10, 20, 30].map((t) => rate.allow(t))).toEqual([true, true, true, false])
    expect(rate.allow(999)).toBe(false)
    expect(rate.allow(1001)).toBe(true) // the first one left the window
  })
})

describe('marks: what to draw', () => {
  it('keeps a finished stroke, then fades it out', () => {
    expect(strokeOpacity({ updatedAt: 0 }, MARK_HOLD_MS)).toBe(1)
    expect(strokeOpacity({ updatedAt: 0 }, MARK_HOLD_MS + MARK_FADE_MS / 2)).toBeCloseTo(0.5)
    expect(strokeOpacity({ updatedAt: 0 }, MARK_HOLD_MS + MARK_FADE_MS)).toBe(0)
  })

  it('builds strokes from pieces, and forgets them once faded', () => {
    const board = new MarksBoard()
    board.addStroke('bob', 's1', [0.1, 0.1], false, 0)
    board.addStroke('bob', 's1', [0.2, 0.2, 0.3, 0.3], true, 100)
    board.addStroke('bob', 's1', [0.9, 0.9], false, 200) // finished: ignored
    const shown = board.visible(200).strokes
    expect(shown).toHaveLength(1)
    expect(shown[0].points).toEqual([0.1, 0.1, 0.2, 0.2, 0.3, 0.3])
    expect(board.visible(100 + MARK_HOLD_MS + MARK_FADE_MS + 1).strokes).toHaveLength(0)
    expect(board.empty).toBe(true)
  })

  it('cuts a very long stroke off', () => {
    const board = new MarksBoard()
    for (let i = 0; i < 40; i++) board.addStroke('bob', 's', new Array(STROKE_MAX_POINTS * 2).fill(0.5), false, i)
    expect(board.visible(40).strokes[0].points.length).toBe(STROKE_TOTAL_POINTS * 2)
  })

  it('shows pointers until they stop moving or leave', () => {
    const board = new MarksBoard()
    board.setPointer('bob', 0.5, 0.5, 0)
    board.setPointer('carol', 0.2, 0.8, 0)
    expect(board.visible(10).pointers.map((p) => p.from)).toEqual(['bob', 'carol'])
    board.setPointer('carol', null, null, 20)
    expect(board.visible(20).pointers.map((p) => p.from)).toEqual(['bob'])
    expect(board.visible(POINTER_IDLE_MS + 1).pointers).toHaveLength(0)
  })

  it("clears one person's marks, or everyone's", () => {
    const board = new MarksBoard()
    board.addStroke('bob', 's1', [0.1, 0.1], true, 0)
    board.addStroke('carol', 's1', [0.2, 0.2], true, 0)
    board.setPointer('bob', 0.5, 0.5, 0)
    board.clear('bob')
    expect(board.visible(1).strokes.map((s) => s.from)).toEqual(['carol'])
    expect(board.visible(1).pointers).toHaveLength(0)
    board.clear(null)
    expect(board.empty).toBe(true)
  })
})

describe('marks: positions across the picture', () => {
  it('finds the picture inside a box with bars', () => {
    const rect = contentRect({ width: 1000, height: 1000 }, { width: 1920, height: 1080 })
    for (const [key, value] of Object.entries({ x: 0, y: 218.75, width: 1000, height: 562.5 })) {
      expect(rect[key as keyof typeof rect]).toBeCloseTo(value)
    }
    expect(contentRect({ width: 400, height: 300 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })

  it('turns a mouse position into 0–1 across the picture, and nothing on the bars', () => {
    const rect = { x: 0, y: 218.75, width: 1000, height: 562.5 }
    expect(toUnit(500, 500, rect)).toEqual({ x: 0.5, y: 0.5 })
    expect(toUnit(0, 218.75, rect)).toEqual({ x: 0, y: 0 })
    expect(toUnit(500, 100, rect)).toBeNull()
  })
})
