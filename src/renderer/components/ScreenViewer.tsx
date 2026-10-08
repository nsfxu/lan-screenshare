import { useEffect, useRef, type ReactNode } from 'react'
import { useLevel } from '../lib/volume'

interface Props {
  stream: MediaStream | null
  /** Shown centered when there is nothing to display (or over a paused stream). */
  placeholder?: ReactNode
  overlay?: ReactNode
  /** Local preview on the host: always muted (no echo of our own system audio). */
  local?: boolean
  /** Whose volume to play this at (a streamer's name): set from the tile's menu or the focus controls. */
  volumeKey?: string
  /** Reports the device-pixel height the video is displayed at. */
  onViewHeight?(pixels: number): void
  /** Called with true while this viewer can't be seen because something else is full screen. */
  onHiddenChange?(hidden: boolean): void
}

/**
 * A stream's picture: the video, a placeholder while there's nothing to show,
 * and the stats overlay. Volume comes from the shared volume store (per
 * streamer); our own preview is always muted. Full screen is the stage's
 * (RoomView), not the viewer's.
 */
export function ScreenViewer({ stream, placeholder, overlay, local, volumeKey, onViewHeight, onHiddenChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const level = useLevel(volumeKey ?? '')
  const hiddenRef = useRef(onHiddenChange)
  hiddenRef.current = onHiddenChange

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !!local || level.muted
    video.volume = level.volume
  }, [level, local, stream])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (video.srcObject !== stream) {
      video.srcObject = stream
      if (stream) void video.play().catch(() => {})
    }
  }, [stream])

  // Something else full screen (another stage, a dialog) hides this one. The
  // viewer may live in a stream's own window: use the document it's in.
  useEffect(() => {
    const doc = containerRef.current?.ownerDocument ?? document
    const onChange = (): void => {
      const full = doc.fullscreenElement
      hiddenRef.current?.(!!full && !full.contains(containerRef.current))
    }
    doc.addEventListener('fullscreenchange', onChange)
    return () => doc.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Report how many pixels of the stream are actually visible, so the sender
  // can match it. Recomputed on resize, full screen and video size changes.
  const reportRef = useRef(onViewHeight)
  reportRef.current = onViewHeight
  useEffect(() => {
    const el = containerRef.current
    const video = videoRef.current
    if (!el || !video || !reportRef.current) return
    // The window the viewer is in (the room's, or a stream's own window): its resize observer and pixel ratio.
    const view = el.ownerDocument.defaultView ?? window
    let timer: number | null = null
    const measure = (): void => {
      if (timer) clearTimeout(timer)
      timer = window.setTimeout(() => {
        const aspect = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoHeight / video.videoWidth : 9 / 16
        const shown = Math.min(el.clientHeight, el.clientWidth * aspect)
        reportRef.current?.(Math.round(shown * view.devicePixelRatio))
      }, 250)
    }
    measure()
    const observer = new view.ResizeObserver(measure)
    observer.observe(el)
    video.addEventListener('resize', measure)
    return () => {
      if (timer) clearTimeout(timer)
      observer.disconnect()
      video.removeEventListener('resize', measure)
    }
  }, [stream])

  return (
    <div ref={containerRef} className="screen-viewer" onContextMenu={(e) => e.preventDefault()}>
      <video
        ref={videoRef}
        className={stream ? '' : 'hidden'}
        autoPlay
        playsInline
        muted={!!local || level.muted}
        disablePictureInPicture
        controls={false}
        data-local={local ? '1' : undefined}
      />
      {placeholder && <div className="screen-placeholder">{placeholder}</div>}
      {overlay && <div className="screen-overlay">{overlay}</div>}
    </div>
  )
}
