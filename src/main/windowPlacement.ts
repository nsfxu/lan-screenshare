/**
 * Development and testing: `--display=<n>` opens the window on screen n
 * (numbered like the source picker: "Screen 1", "Screen 2", …) and
 * `--tile=<i>/<count>` gives it one of `count` side-by-side slots of that
 * screen, so several instances (`--profile=…`) sit next to each other, e.g.
 * away from the screen you're using. A placed window is shown without taking
 * focus.
 */
export interface Placement {
  /** 1-based screen number. */
  display: number
  /** 1-based slot. */
  tile: number
  tiles: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function parsePlacement(argv: readonly string[]): Placement | null {
  const value = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const display = Number(value('display'))
  if (!Number.isInteger(display) || display < 1) return null
  const tile = /^(\d+)\/(\d+)$/.exec(value('tile') ?? '')
  const tiles = tile ? Number(tile[2]) : 1
  const index = tile ? Number(tile[1]) : 1
  if (tiles < 1 || index < 1 || index > tiles) return { display, tile: 1, tiles: 1 }
  return { display, tile: index, tiles }
}

/** Slot `tile` of `tiles` equal columns across `area` (whole pixels, no gaps or overlaps). */
export function tileBounds(area: Rect, tile: number, tiles: number): Rect {
  const left = area.x + Math.round(((tile - 1) * area.width) / tiles)
  const right = area.x + Math.round((tile * area.width) / tiles)
  return { x: left, y: area.y, width: right - left, height: area.height }
}
