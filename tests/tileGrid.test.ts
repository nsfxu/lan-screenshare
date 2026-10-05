import { describe, expect, it } from 'vitest'
import { bestTileGrid } from '../src/shared/tileGrid'

describe('tile grid', () => {
  it('fills a wide stage with one big 16:9 tile', () => {
    expect(bestTileGrid(1, 1600, 900, 0)).toEqual({ columns: 1, width: 1600, height: 900 })
    expect(bestTileGrid(1, 2000, 900, 0)).toEqual({ columns: 1, width: 1600, height: 900 })
  })

  it('puts two tiles side by side on a wide stage, stacked on a tall one', () => {
    expect(bestTileGrid(2, 1600, 900, 0).columns).toBe(2)
    expect(bestTileGrid(2, 400, 900, 0).columns).toBe(1)
  })

  it('uses 2×2 for four tiles on a 16:9 stage, and 3 across for nine', () => {
    expect(bestTileGrid(4, 1600, 900, 0)).toEqual({ columns: 2, width: 800, height: 450 })
    expect(bestTileGrid(9, 1600, 900, 0).columns).toBe(3)
  })

  it('leaves room for the gaps', () => {
    const grid = bestTileGrid(2, 1606, 900, 6)
    expect(grid.columns * grid.width + 6).toBeLessThanOrEqual(1606)
  })
})
