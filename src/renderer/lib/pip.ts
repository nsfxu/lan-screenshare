import { useSyncExternalStore } from 'react'
import type { Subscription } from './subscription'

/**
 * Picture-in-picture for a watched stream: a small always-on-top window that
 * keeps playing while you use other apps. One stream at a time, as Chromium
 * allows.
 *
 * It plays from a video element of its own, kept off screen, not the tile's:
 * tiles are re-created when the layout changes (focus, the grid, the strip),
 * and Chromium closes picture-in-picture when its element goes away. That
 * element is muted; the sound keeps coming from the tile, at its volume.
 */

/** Long enough for a stream that is already playing, short enough to keep the click's user activation. */
const METADATA_TIMEOUT_MS = 4000

interface Current {
  sub: Subscription
  offs: (() => void)[]
  /** Set once the window is open: a leave event before that belongs to the previous stream. */
  win: PictureInPictureWindow | null
}

let video: HTMLVideoElement | null = null
let current: Current | null = null
const listeners = new Set<() => void>()

/** The streamer whose stream is in picture-in-picture, if any. */
export function pipStreamer(): string | null {
  return current?.sub.streamerId ?? null
}

/** The subscription in picture-in-picture, if any. */
export function pipSubscription(): Subscription | null {
  return current?.sub ?? null
}

export function usePipStreamer(): string | null {
  return useSyncExternalStore(subscribe, pipStreamer)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  listeners.forEach((l) => l())
}

/** Whether this Chromium offers picture-in-picture at all (it can be turned off). */
export function pipSupported(): boolean {
  return document.pictureInPictureEnabled
}

/**
 * Show `sub` in picture-in-picture, replacing another stream that is there.
 * Call it from a click: Chromium only opens the window for one. Resolves to
 * false if it couldn't be opened.
 */
export async function openPip(sub: Subscription): Promise<boolean> {
  if (current?.sub === sub) return true
  await closePip()
  const el = element()
  const entry: Current = { sub, offs: [], win: null }
  current = entry
  const show = (stream: MediaStream | null): void => {
    if (!stream) {
      void closePip()
      return
    }
    if (el.srcObject !== stream) {
      el.srcObject = stream
      void el.play().catch(() => {})
    }
  }
  entry.offs.push(
    sub.on('stream', show),
    sub.on('state', (state) => state === 'ended' && void closePip())
  )
  notify()
  try {
    if (!sub.stream) throw new Error('nothing to show yet')
    show(sub.stream)
    await metadata(el)
    const win = await el.requestPictureInPicture()
    if (current !== entry) return false // closed (or replaced) meanwhile
    entry.win = win
    const report = (): void => sub.setPip(Math.round(win.height * window.devicePixelRatio))
    win.addEventListener('resize', report)
    entry.offs.push(() => win.removeEventListener('resize', report))
    report()
    return true
  } catch (err) {
    window.api.system.log('warn', `[pip] couldn't open: ${err instanceof Error ? err.message : String(err)}`)
    if (current === entry) release()
    return false
  }
}

/** Close picture-in-picture (from our buttons; the window's own × lands in release() too). */
export async function closePip(): Promise<void> {
  const entry = current
  if (!entry) return
  if (video && document.pictureInPictureElement === video) await document.exitPictureInPicture().catch(() => {})
  if (current === entry) release()
}

export function togglePip(sub: Subscription): Promise<boolean> {
  if (current?.sub === sub) return closePip().then(() => true)
  return openPip(sub)
}

function release(): void {
  const entry = current
  if (!entry) return
  current = null
  entry.offs.forEach((off) => off())
  entry.sub.setPip(null)
  if (video) video.srcObject = null
  notify()
}

function element(): HTMLVideoElement {
  if (video) return video
  const el = document.createElement('video')
  el.className = 'pip-source'
  el.muted = true
  el.playsInline = true
  el.addEventListener('leavepictureinpicture', () => {
    if (current?.win) release()
  })
  document.body.append(el)
  video = el
  return el
}

function metadata(el: HTMLVideoElement): Promise<void> {
  if (el.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      el.removeEventListener('loadedmetadata', done)
      reject(new Error('the stream has no picture yet'))
    }, METADATA_TIMEOUT_MS)
    function done(): void {
      clearTimeout(timer)
      resolve()
    }
    el.addEventListener('loadedmetadata', done, { once: true })
  })
}
