import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  stream: MediaStream | null
  /** Shown centered when there is nothing to display (or over a paused stream). */
  placeholder?: ReactNode
  overlay?: ReactNode
  /** Local preview on the host: always muted (no echo of our own system audio). */
  local?: boolean
  /** Show volume controls; false greys them out (host is not sending audio). */
  audioAvailable?: boolean
  /** Remember volume under this key (e.g. per streamer); defaults to one shared setting. */
  volumeKey?: string
  /** Reports the device-pixel height the video is displayed at (including zoom). */
  onViewHeight?(pixels: number): void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 8
const VOLUME_KEY = 'screenshare.volume'

/** Saved volume for `key`, falling back to the last volume used anywhere. */
function loadVolume(key: string): { volume: number; muted: boolean } {
  for (const k of [key, VOLUME_KEY]) {
    try {
      const saved = JSON.parse(localStorage.getItem(k) ?? 'null') as { volume: number; muted: boolean } | null
      if (saved && typeof saved.volume === 'number') return { volume: Math.min(1, Math.max(0, saved.volume)), muted: !!saved.muted }
    } catch {
      // storage unavailable
    }
  }
  return { volume: 1, muted: false }
}

/**
 * Remote (or local preview) screen display with zoom (mouse wheel, anchored
 * at the cursor), click-drag panning while zoomed, double-click to reset, and
 * a full-screen toggle. Viewers also get volume/mute for the host's system
 * audio (remembered on this machine); the host's own preview is always muted.
 */
export function ScreenViewer({ stream, placeholder, overlay, local, audioAvailable, volumeKey, onViewHeight }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const storageKey = volumeKey ? `${VOLUME_KEY}:${volumeKey}` : VOLUME_KEY
  const [audio, setAudio] = useState(() => loadVolume(storageKey))

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !!local || audio.muted
    video.volume = audio.volume
    if (local) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(audio))
      // Also becomes the starting volume for streams without their own setting.
      localStorage.setItem(VOLUME_KEY, JSON.stringify(audio))
    } catch {
      // storage unavailable
    }
  }, [audio, local, stream, storageKey])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (video.srcObject !== stream) {
      video.srcObject = stream
      if (stream) void video.play().catch(() => {})
    }
  }, [stream])

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Report how many pixels of the stream are actually visible, so the sender
  // can match it. Recomputed on resize, zoom, fullscreen and video size changes.
  const reportRef = useRef(onViewHeight)
  reportRef.current = onViewHeight
  useEffect(() => {
    const el = containerRef.current
    const video = videoRef.current
    if (!el || !video || !reportRef.current) return
    let timer: number | null = null
    const measure = (): void => {
      if (timer) clearTimeout(timer)
      timer = window.setTimeout(() => {
        const aspect = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoHeight / video.videoWidth : 9 / 16
        const shown = Math.min(el.clientHeight, el.clientWidth * aspect)
        reportRef.current?.(Math.round(shown * zoom * window.devicePixelRatio))
      }, 250)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    video.addEventListener('resize', measure)
    return () => {
      if (timer) clearTimeout(timer)
      observer.disconnect()
      video.removeEventListener('resize', measure)
    }
  }, [zoom, fullscreen, stream])

  const clampPan = useCallback((x: number, y: number, z: number) => {
    const el = containerRef.current
    if (!el) return { x, y }
    const maxX = (el.clientWidth * (z - 1)) / 2
    const maxY = (el.clientHeight * (z - 1)) / 2
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) }
  }, [])

  const zoomAt = useCallback(
    (nextZoom: number, clientX?: number, clientY?: number) => {
      const el = containerRef.current
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom))
      if (!el) return
      const rect = el.getBoundingClientRect()
      // Keep the point under the cursor fixed while zooming.
      const cx = (clientX ?? rect.left + rect.width / 2) - rect.left - rect.width / 2
      const cy = (clientY ?? rect.top + rect.height / 2) - rect.top - rect.height / 2
      const ratio = z / zoom
      const nx = cx - (cx - pan.x) * ratio
      const ny = cy - (cy - pan.y) * ratio
      setZoom(z)
      setPan(z === 1 ? { x: 0, y: 0 } : clampPan(nx, ny, z))
    },
    [zoom, pan, clampPan]
  )

  // Wheel listener must be non-passive to prevent page scroll.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      zoomAt(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, zoomAt])

  const reset = (): void => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void containerRef.current?.requestFullscreen()
  }

  return (
    <div
      ref={containerRef}
      className={`screen-viewer ${zoom > 1 ? 'zoomed' : ''} ${dragging ? 'dragging' : ''}`}
      onMouseDown={(e) => {
        if (zoom <= 1 || e.button !== 0) return
        dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
        setDragging(true)
      }}
      onMouseMove={(e) => {
        const s = dragStart.current
        if (!s) return
        setPan(clampPan(s.panX + e.clientX - s.x, s.panY + e.clientY - s.y, zoom))
      }}
      onMouseUp={() => {
        dragStart.current = null
        setDragging(false)
      }}
      onMouseLeave={() => {
        dragStart.current = null
        setDragging(false)
      }}
      onDoubleClick={() => (zoom > 1 ? reset() : zoomAt(2))}
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        className={stream ? '' : 'hidden'}
        autoPlay
        playsInline
        muted={!!local || audio.muted}
        disablePictureInPicture
        controls={false}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        data-local={local ? '1' : undefined}
      />
      {placeholder && <div className="screen-placeholder">{placeholder}</div>}
      {overlay && <div className="screen-overlay">{overlay}</div>}
      <div className="screen-controls" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {!local && (
          <div className={`volume ${audioAvailable ? '' : 'unavailable'}`} title={audioAvailable ? undefined : 'The host is not sharing audio'}>
            <button
              className="icon-btn"
              title={audio.muted || audio.volume === 0 ? 'Unmute' : 'Mute'}
              onClick={() => setAudio((a) => (a.muted || a.volume === 0 ? { volume: a.volume || 1, muted: false } : { ...a, muted: true }))}
            >
              <Icon name={audio.muted || audio.volume === 0 || !audioAvailable ? 'volumeOff' : 'volume'} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={audio.muted ? 0 : audio.volume}
              aria-label="Volume"
              onChange={(e) => setAudio({ volume: Number(e.target.value), muted: Number(e.target.value) === 0 })}
            />
          </div>
        )}
        <button className="icon-btn" title="Zoom out" onClick={() => zoomAt(zoom / 1.25)} disabled={zoom <= MIN_ZOOM}>
          <Icon name="zoomOut" />
        </button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="icon-btn" title="Zoom in" onClick={() => zoomAt(zoom * 1.25)} disabled={zoom >= MAX_ZOOM}>
          <Icon name="zoomIn" />
        </button>
        <button className="icon-btn" title="Fit to window" onClick={reset} disabled={zoom === 1}>
          <Icon name="fit" />
        </button>
        <button className="icon-btn" title={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}>
          <Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} />
        </button>
      </div>
    </div>
  )
}
