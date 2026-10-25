/**
 * Windows on other macOS desktops (Spaces) for the share picker.
 *
 * Chromium's list (desktopCapturer) only has the windows on the current
 * desktop, but it captures a window on another one when given its id. The
 * native helper (native/mac-window-list) lists every window; these pick the
 * ones worth offering.
 */

/** One window as the helper prints it. */
export interface NativeWindow {
  /** CGWindowID: Chromium's source id is `window:<id>:0`. */
  id: number
  pid: number
  app: string
  /** Empty without the Screen Recording permission. */
  title: string
  width: number
  height: number
  onScreen: boolean
  /** The app's bundle, for its icon. */
  bundle?: string | null
}

/** Smaller windows are helpers and popups (macOS keeps many 64×64 and 33 px tall ones around). */
export const OFFSCREEN_MIN_SIZE = 100

export function windowSourceId(id: number): string {
  return `window:${id}:0`
}

/**
 * The windows to add to the picker: off this desktop (or minimized), not
 * already listed by Chromium, not ours, big enough and with a title. Windows
 * without a title are hidden ones (and all of them are, without the
 * permission); sorted by app, then title.
 */
export function offscreenWindows(windows: NativeWindow[], listed: ReadonlySet<string>, ownPid: number): NativeWindow[] {
  return windows
    .filter(
      (w) =>
        !w.onScreen &&
        w.pid !== ownPid &&
        w.title.trim() !== '' &&
        w.width >= OFFSCREEN_MIN_SIZE &&
        w.height >= OFFSCREEN_MIN_SIZE &&
        !listed.has(windowSourceId(w.id))
    )
    .sort((a, b) => a.app.localeCompare(b.app) || a.title.localeCompare(b.title) || a.id - b.id)
}

/** "Brave Browser — GitHub": a browser's title alone says which page, not which app. */
export function windowName(w: Pick<NativeWindow, 'app' | 'title'>): string {
  const title = w.title.trim()
  if (!title || !w.app || title.toLowerCase().includes(w.app.toLowerCase())) return title || w.app
  return `${w.app} — ${title}`
}

/** The helper's output, keeping only well-formed entries. */
export function parseNativeWindows(json: string): NativeWindow[] {
  const data: unknown = JSON.parse(json)
  if (!Array.isArray(data)) return []
  return data.filter(
    (w): w is NativeWindow =>
      typeof w === 'object' &&
      w !== null &&
      Number.isInteger(w.id) &&
      Number.isInteger(w.pid) &&
      typeof w.app === 'string' &&
      typeof w.title === 'string' &&
      typeof w.width === 'number' &&
      typeof w.height === 'number' &&
      typeof w.onScreen === 'boolean'
  )
}
