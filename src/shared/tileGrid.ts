/** How `count` tiles fill a stage: columns, and each tile's size in px. */
export interface TileGrid {
  columns: number
  width: number
  height: number
}

/**
 * The column count that makes `count` tiles of a fixed shape (16:9 by
 * default) as large as possible in a `width` × `height` area, with `gap` px
 * between them.
 */
export function bestTileGrid(count: number, width: number, height: number, gap = 6, ratio = 16 / 9): TileGrid {
  let best: TileGrid = { columns: 1, width: 0, height: 0 }
  const n = Math.max(1, count)
  for (let columns = 1; columns <= n; columns++) {
    const rows = Math.ceil(n / columns)
    const tileWidth = Math.min((width - gap * (columns - 1)) / columns, ((height - gap * (rows - 1)) / rows) * ratio)
    // On a tie (two tiles on a 16:9 stage), side by side.
    if (tileWidth >= best.width) best = { columns, width: Math.floor(tileWidth), height: Math.floor(tileWidth / ratio) }
  }
  return best
}
