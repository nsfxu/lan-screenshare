import type { CursorWatchState } from '../../shared/types'

type Listener = (state: CursorWatchState) => void

const listeners = new Set<Listener>()
let latest: CursorWatchState | null = null
let stop: (() => void) | null = null

/**
 * The Windows foreground helper (main/cursorWatch.ts: cursor visibility and
 * the foreground window) is a single process; this shares it between its
 * users (the game-cursor switch, automatic quality). It runs while anyone
 * listens, and a new listener gets the latest state right away, since the
 * helper only reports changes. Elsewhere nothing is ever reported.
 */
export function watchForeground(listener: Listener): () => void {
  listeners.add(listener)
  if (latest) listener(latest)
  if (!stop) {
    const api = window.api.capture.hiddenCursor
    const off = api.onChanged((state) => {
      latest = state
      for (const l of listeners) l(state)
    })
    void api.watch()
    stop = () => {
      off()
      void api.unwatch()
      latest = null
    }
  }
  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return
    stop?.()
    stop = null
  }
}
