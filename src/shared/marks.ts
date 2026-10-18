/**
 * Drawing on a stream (2.6.0): people watching a stream can point at it and
 * draw quick marks that everyone watching, and the streamer, see. Positions
 * are 0–1 across the shared source, so a mark lands in the same place on any
 * tile size, on the streamer's screen, or on a window that moves.
 *
 * Pure logic, shared by the room server (validation, rate limits) and the
 * apps (what to draw now). Nothing is recorded: marks fade, and go away when
 * the stream stops.
 */

/** Pointer updates a person may send per second (more are dropped). */
export const POINTER_RATE = 30
/** Stroke pieces a person may send per second. */
export const STROKE_RATE = 30
/** Points (x, y pairs) in one stroke piece. */
export const STROKE_MAX_POINTS = 64
/** Points in a whole stroke: a long scribble is cut off there. */
export const STROKE_TOTAL_POINTS = 2000
/** Stroke ids are short strings picked by the drawer. */
export const STROKE_ID_MAX = 16
/** Clears a person may send per second. */
export const CLEAR_RATE = 5

/** A finished stroke stays this long, then fades out over MARK_FADE_MS. */
export const MARK_HOLD_MS = 3000
export const MARK_FADE_MS = 1500
/** A pointer that hasn't moved for this long disappears. */
export const POINTER_IDLE_MS = 3000

export function isUnit(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
}

/** A stroke piece's points: [x0, y0, x1, y1, …], 1 to STROKE_MAX_POINTS pairs, each 0–1. Null if not. */
export function strokePoints(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > STROKE_MAX_POINTS * 2 || raw.length % 2 !== 0) return null
  return raw.every(isUnit) ? (raw as number[]) : null
}

export function isStrokeId(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= STROKE_ID_MAX && /^[\w-]+$/.test(raw)
}

/** At most `limit` events in any second (a sliding window), like the chat's flood limit. */
export class RateWindow {
  private times: number[] = []
  constructor(private readonly limit: number, private readonly windowMs = 1000) {}

  allow(now: number): boolean {
    this.times = this.times.filter((t) => now - t < this.windowMs)
    if (this.times.length >= this.limit) return false
    this.times.push(now)
    return true
  }
}

export interface Stroke {
  from: string
  id: string
  points: number[]
  done: boolean
  /** When it was last drawn to (finished strokes fade from then). */
  updatedAt: number
}

export interface Pointer {
  from: string
  x: number
  y: number
  movedAt: number
}

/**
 * The marks on one stream: everyone's strokes and pointers, and how visible
 * each is at a given time. Fed by our own drawing and by the room's messages.
 */
export class MarksBoard {
  private strokes = new Map<string, Stroke>()
  private pointers = new Map<string, Pointer>()

  /** Adds points to a stroke (starting it if new). */
  addStroke(from: string, id: string, points: readonly number[], done: boolean, now: number): void {
    const key = `${from}:${id}`
    const stroke = this.strokes.get(key) ?? { from, id, points: [], done: false, updatedAt: now }
    if (stroke.done) return
    const room = STROKE_TOTAL_POINTS * 2 - stroke.points.length
    if (room > 0) stroke.points.push(...points.slice(0, room))
    stroke.done = done
    stroke.updatedAt = now
    this.strokes.set(key, stroke)
  }

  /** Moves someone's pointer, or hides it (null). */
  setPointer(from: string, x: number | null, y: number | null, now: number): void {
    if (x === null || y === null) this.pointers.delete(from)
    else this.pointers.set(from, { from, x, y, movedAt: now })
  }

  /** Removes one person's marks, or everyone's. */
  clear(from: string | null): void {
    if (from === null) {
      this.strokes.clear()
      this.pointers.clear()
      return
    }
    for (const [key, s] of this.strokes) if (s.from === from) this.strokes.delete(key)
    this.pointers.delete(from)
  }

  /** Someone left the stream: their pointer goes, their strokes fade as usual. */
  removePointer(from: string): void {
    this.pointers.delete(from)
  }

  /** What to draw at `now`, with each stroke's opacity; forgets what has faded out. */
  visible(now: number): { strokes: (Stroke & { opacity: number })[]; pointers: Pointer[] } {
    const strokes: (Stroke & { opacity: number })[] = []
    for (const [key, s] of this.strokes) {
      const opacity = strokeOpacity(s, now)
      if (opacity <= 0) this.strokes.delete(key)
      else strokes.push({ ...s, opacity })
    }
    const pointers: Pointer[] = []
    for (const [from, p] of this.pointers) {
      if (now - p.movedAt > POINTER_IDLE_MS) this.pointers.delete(from)
      else pointers.push(p)
    }
    return { strokes, pointers }
  }

  get empty(): boolean {
    return this.strokes.size === 0 && this.pointers.size === 0
  }
}

/**
 * 1 while being drawn and for MARK_HOLD_MS after its last point, then down to
 * 0 over MARK_FADE_MS. A stroke left unfinished (its drawer went away) fades
 * the same way.
 */
export function strokeOpacity(stroke: Pick<Stroke, 'updatedAt'>, now: number): number {
  const age = now - stroke.updatedAt
  if (age <= MARK_HOLD_MS) return 1
  return Math.max(0, 1 - (age - MARK_HOLD_MS) / MARK_FADE_MS)
}

/**
 * Where the picture is inside a box it's fitted into (object-fit: contain):
 * marks are 0–1 across the picture, not the box, which may have bars.
 */
export function contentRect(
  box: { width: number; height: number },
  picture: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  if (picture.width <= 0 || picture.height <= 0 || box.width <= 0 || box.height <= 0) {
    return { x: 0, y: 0, width: box.width, height: box.height }
  }
  const scale = Math.min(box.width / picture.width, box.height / picture.height)
  const width = picture.width * scale
  const height = picture.height * scale
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height }
}

/** A point in a box (e.g. a mouse position) as 0–1 across the fitted picture; null outside it. */
export function toUnit(
  px: number,
  py: number,
  rect: { x: number; y: number; width: number; height: number }
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  const x = (px - rect.x) / rect.width
  const y = (py - rect.y) / rect.height
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 }
}
