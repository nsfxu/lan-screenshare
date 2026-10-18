import { MarksBoard, POINTER_RATE, STROKE_MAX_POINTS } from '../../shared/marks'
import type { Participant, RoomState } from '../../shared/types'
import { Emitter } from './emitter'
import type { RoomClient } from './roomClient'

/** Stroke pieces go out this often while drawing (well under the server's 30/s). */
const STROKE_FLUSH_MS = 50

type Events = {
  /** The marks on this streamer's stream changed (redraw it). */
  changed: string
}

/**
 * The marks on the streams we see (shared/marks.ts): everyone's, from the
 * room's messages, and our own, drawn at once without waiting for the round
 * trip. Our pointer is sent at most POINTER_RATE times a second; strokes go
 * out in small pieces while they're drawn. Marks on a stream go away when it
 * stops, and when drawing is turned off there.
 */
export class Marks extends Emitter<Events> {
  private boards = new Map<string, MarksBoard>()
  private offs: (() => void)[] = []
  private pointerTimer: number | null = null
  private pendingPointer: { streamer: string; x: number | null; y: number | null } | null = null
  private lastPointerAt = 0
  private stroke: { streamer: string; id: string; pending: number[]; last: number[]; timer: number | null } | null = null
  private nextStroke = 0

  constructor(private readonly client: RoomClient) {
    super()
    this.offs.push(
      client.on('message', (msg) => {
        const now = Date.now()
        switch (msg.type) {
          case 'pointer':
            this.board(msg.streamer).setPointer(msg.from, msg.x, msg.y, now)
            return this.emit('changed', msg.streamer)
          case 'stroke':
            this.board(msg.streamer).addStroke(msg.from, msg.id, msg.points, msg.done, now)
            return this.emit('changed', msg.streamer)
          case 'marks-cleared':
            this.board(msg.streamer).clear(msg.all ? null : msg.from)
            return this.emit('changed', msg.streamer)
          case 'stream-ended':
            return this.drop(msg.streamer)
        }
      }),
      client.on('participants', () => this.prune()),
      client.on('room', () => this.prune())
    )
  }

  board(streamer: string): MarksBoard {
    let board = this.boards.get(streamer)
    if (!board) this.boards.set(streamer, (board = new MarksBoard()))
    return board
  }

  /** Whether we may draw on this stream: the host's server and the streamer's app both support it and allow it. */
  canDraw(streamer: string): boolean {
    return canDrawOn(this.client.room, this.client.participants.find((p) => p.id === streamer), this.client.selfId)
  }

  /** Our pointer over a stream we watch, at 0–1 across the picture; null when it leaves. */
  pointer(streamer: string, x: number | null, y: number | null): void {
    this.pendingPointer = { streamer, x, y }
    const wait = this.lastPointerAt + 1000 / POINTER_RATE - Date.now()
    if (wait <= 0) this.flushPointer()
    else if (this.pointerTimer === null) this.pointerTimer = window.setTimeout(() => this.flushPointer(), wait)
  }

  /** Starts a stroke at a point (0–1). */
  strokeStart(streamer: string, x: number, y: number): void {
    this.strokeEnd()
    const id = `${this.client.selfId.slice(0, 6)}-${(this.nextStroke++).toString(36)}`.replace(/[^\w-]/g, '')
    this.stroke = { streamer, id, pending: [], last: [], timer: null }
    this.strokeTo(x, y)
  }

  strokeTo(x: number, y: number): void {
    const s = this.stroke
    if (!s) return
    this.board(s.streamer).addStroke(this.client.selfId, s.id, [x, y], false, Date.now())
    this.emit('changed', s.streamer)
    s.pending.push(x, y)
    s.last = [x, y]
    if (s.pending.length >= STROKE_MAX_POINTS * 2) this.flushStroke(false)
    else if (s.timer === null) s.timer = window.setTimeout(() => this.flushStroke(false), STROKE_FLUSH_MS)
  }

  strokeEnd(): void {
    const s = this.stroke
    if (!s) return
    this.board(s.streamer).addStroke(this.client.selfId, s.id, [], true, Date.now())
    this.flushStroke(true)
    this.stroke = null
  }

  /** Removes our marks from a stream we watch, or, on our own stream, everyone's. */
  clear(streamer: string): void {
    const own = streamer === this.client.selfId
    this.board(streamer).clear(own ? null : this.client.selfId)
    this.emit('changed', streamer)
    this.client.send({ type: 'clear-marks', streamer })
  }

  dispose(): void {
    this.offs.forEach((off) => off())
    if (this.pointerTimer !== null) clearTimeout(this.pointerTimer)
    if (this.stroke?.timer) clearTimeout(this.stroke.timer)
    this.removeAllListeners()
  }

  private flushPointer(): void {
    this.pointerTimer = null
    const p = this.pendingPointer
    if (!p) return
    this.pendingPointer = null
    this.lastPointerAt = Date.now()
    this.client.send({ type: 'pointer', streamer: p.streamer, x: p.x, y: p.y })
  }

  private flushStroke(done: boolean): void {
    const s = this.stroke
    if (!s) return
    if (s.timer !== null) clearTimeout(s.timer)
    s.timer = null
    // A finished stroke with nothing new resends its last point, just to say it's done.
    if (s.pending.length === 0 && done) s.pending.push(...s.last)
    while (s.pending.length > 0) {
      const points = s.pending.splice(0, STROKE_MAX_POINTS * 2)
      this.client.send({ type: 'stroke', streamer: s.streamer, id: s.id, points, done: done && s.pending.length === 0 })
    }
  }

  private drop(streamer: string): void {
    if (this.stroke?.streamer === streamer) this.stroke = null
    if (this.boards.delete(streamer)) this.emit('changed', streamer)
  }

  /** Streams that stopped, or where drawing is no longer allowed, lose their marks. */
  private prune(): void {
    for (const streamer of [...this.boards.keys()]) {
      const p = this.client.participants.find((x) => x.id === streamer)
      const allowed = this.client.room?.drawingAllowed === true && p?.stream?.drawing === true
      if (!allowed) this.drop(streamer)
    }
  }
}

/** Drawing needs a host and a streamer on 2.6.0+ (they say so), both allowing it, and someone else's stream. */
export function canDrawOn(room: RoomState | null, streamer: Participant | undefined, selfId: string): boolean {
  return room?.drawingAllowed === true && streamer?.stream?.drawing === true && streamer.id !== selfId
}
