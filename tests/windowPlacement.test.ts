import { describe, expect, it } from 'vitest'
import { parsePlacement, tileBounds } from '../src/main/windowPlacement'

describe('window placement', () => {
  it('reads --display and --tile', () => {
    expect(parsePlacement(['electron', '.', '--profile=a', '--display=3', '--tile=2/2'])).toEqual({
      display: 3,
      tile: 2,
      tiles: 2
    })
    expect(parsePlacement(['--display=2'])).toEqual({ display: 2, tile: 1, tiles: 1 })
  })

  it('ignores missing or invalid values', () => {
    expect(parsePlacement(['electron', '.'])).toBeNull()
    expect(parsePlacement(['--display=0'])).toBeNull()
    expect(parsePlacement(['--display=x'])).toBeNull()
    expect(parsePlacement(['--tile=1/2'])).toBeNull()
    expect(parsePlacement(['--display=1', '--tile=3/2'])).toEqual({ display: 1, tile: 1, tiles: 1 })
  })

  it('splits the work area into columns without gaps', () => {
    const area = { x: 1920, y: 0, width: 1920, height: 1040 }
    expect(tileBounds(area, 1, 2)).toEqual({ x: 1920, y: 0, width: 960, height: 1040 })
    expect(tileBounds(area, 2, 2)).toEqual({ x: 2880, y: 0, width: 960, height: 1040 })
    const thirds = [1, 2, 3].map((i) => tileBounds({ x: -1920, y: 0, width: 1000, height: 500 }, i, 3))
    expect(thirds.map((r) => r.x)).toEqual([-1920, -1587, -1253])
    expect(thirds.reduce((sum, r) => sum + r.width, 0)).toBe(1000)
  })
})
