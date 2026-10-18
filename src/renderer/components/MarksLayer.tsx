import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { contentRect, toUnit } from '../../shared/marks'
import type { Participant } from '../../shared/types'
import type { Marks } from '../lib/marks'

interface Props {
  marks: Marks
  streamer: string
  participants: Participant[]
  /** Our pen is on: the mouse points and draws here. */
  pen?: boolean
  /**
   * 'video': over a tile, marks are 0–1 across the picture inside it (which
   * may have bars). 'fill': the streamer's overlay, which covers exactly the
   * shared screen.
   */
  fit: 'video' | 'fill'
}

/**
 * Draws the marks on one stream (shared/marks.ts) on a canvas laid over it:
 * strokes in each person's colour, fading after a few seconds, and pointers as
 * a dot with the person's name. With the pen on, the mouse sends our pointer
 * and drags draw strokes. Styles are inline: the streamer's overlay window has
 * none of the app's CSS.
 */
export function MarksLayer({ marks, streamer, participants, pen = false, fit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peopleRef = useRef(participants)
  peopleRef.current = participants
  const drawing = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const view = canvas.ownerDocument.defaultView ?? window
    let frame: number | null = null
    const draw = (): void => {
      frame = null
      const dpr = view.devicePixelRatio || 1
      const width = Math.round(canvas.clientWidth * dpr)
      const height = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, width, height)
      const rect = pictureRect(canvas, fit, dpr)
      const { strokes, pointers } = marks.board(streamer).visible(Date.now())
      const colour = (id: string): string => peopleRef.current.find((p) => p.id === id)?.color ?? '#ffffff'
      const line = Math.max(3 * dpr, rect.height * 0.007)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const s of strokes) {
        if (s.points.length < 2) continue
        ctx.globalAlpha = s.opacity
        ctx.beginPath()
        for (let i = 0; i < s.points.length; i += 2) {
          const x = rect.x + s.points[i] * rect.width
          const y = rect.y + s.points[i + 1] * rect.height
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        if (s.points.length === 2) ctx.lineTo(rect.x + s.points[0] * rect.width + 0.1, rect.y + s.points[1] * rect.height)
        // A dark edge keeps a mark visible on any picture.
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
        ctx.lineWidth = line + 2 * dpr
        ctx.stroke()
        ctx.strokeStyle = colour(s.from)
        ctx.lineWidth = line
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`
      for (const p of pointers) {
        const x = rect.x + p.x * rect.width
        const y = rect.y + p.y * rect.height
        ctx.beginPath()
        ctx.arc(x, y, 6 * dpr, 0, Math.PI * 2)
        ctx.fillStyle = colour(p.from)
        ctx.fill()
        ctx.lineWidth = 2 * dpr
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
        const name = peopleRef.current.find((q) => q.id === p.from)?.name ?? ''
        if (!name) continue
        const textWidth = ctx.measureText(name).width
        const pad = 5 * dpr
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
        ctx.beginPath()
        ctx.roundRect(x + 10 * dpr, y + 6 * dpr, textWidth + pad * 2, 18 * dpr, 6 * dpr)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.fillText(name, x + 10 * dpr + pad, y + 19 * dpr)
      }
      // For tests and debugging: what's on the canvas now.
      canvas.dataset.strokes = String(strokes.length)
      canvas.dataset.pointers = pointers.map((p) => peopleRef.current.find((q) => q.id === p.from)?.name ?? p.from).join(',')
      // Fading strokes and idle pointers change by themselves: keep drawing while there are any.
      if (strokes.length > 0 || pointers.length > 0) schedule()
    }
    const schedule = (): void => {
      if (frame === null) frame = view.requestAnimationFrame(draw)
    }
    schedule()
    const off = marks.on('changed', (id) => id === streamer && schedule())
    const resize = new view.ResizeObserver(schedule)
    resize.observe(canvas)
    return () => {
      off()
      resize.disconnect()
      if (frame !== null) view.cancelAnimationFrame(frame)
    }
  }, [marks, streamer, fit])

  const unit = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = e.currentTarget
    const box = canvas.getBoundingClientRect()
    return toUnit(e.clientX - box.left, e.clientY - box.top, pictureRect(canvas, fit, 1))
  }

  // Clicks with the pen draw: they mustn't also focus the tile or open full screen.
  const swallow = pen ? (e: { stopPropagation(): void }) => e.stopPropagation() : undefined
  return (
    <canvas
      ref={canvasRef}
      className="marks-layer"
      data-pen={pen ? 'on' : undefined}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 2,
        pointerEvents: pen ? 'auto' : 'none',
        cursor: pen ? 'crosshair' : undefined,
        touchAction: 'none'
      }}
      onClick={swallow}
      onDoubleClick={swallow}
      onPointerMove={
        pen
          ? (e) => {
              const p = unit(e)
              if (drawing.current && p) marks.strokeTo(p.x, p.y)
              marks.pointer(streamer, p?.x ?? null, p?.y ?? null)
            }
          : undefined
      }
      onPointerDown={
        pen
          ? (e) => {
              if (e.button !== 0) return
              const p = unit(e)
              if (!p) return
              e.currentTarget.setPointerCapture(e.pointerId)
              drawing.current = true
              marks.strokeStart(streamer, p.x, p.y)
            }
          : undefined
      }
      onPointerUp={
        pen
          ? () => {
              if (!drawing.current) return
              drawing.current = false
              marks.strokeEnd()
            }
          : undefined
      }
      onPointerLeave={pen ? () => !drawing.current && marks.pointer(streamer, null, null) : undefined}
    />
  )
}

/** Where the picture is on the canvas, in canvas pixels (`scale` = device pixel ratio, or 1 for CSS pixels). */
function pictureRect(canvas: HTMLCanvasElement, fit: 'video' | 'fill', scale: number) {
  const box = { width: canvas.clientWidth * scale, height: canvas.clientHeight * scale }
  if (fit === 'fill') return { x: 0, y: 0, ...box }
  const video = canvas.parentElement?.querySelector('video')
  return contentRect(box, { width: video?.videoWidth ?? 0, height: video?.videoHeight ?? 0 })
}
