import { useEffect, useRef, useState } from 'react'

/** How long the cursor must stay hidden before suggesting anything (games flash it in menus). */
const HIDDEN_FOR_MS = 1500

export interface HiddenCursorHint {
  /** Capture source id of the game's window. */
  windowId: string
  name: string
}

/**
 * While a whole screen is shared on Windows before 11 24H2, notices when a
 * game hides the mouse cursor, which viewers still see as an arrow (see
 * main/cursorWatch.ts), and suggests sharing that game's window instead.
 * The hint stays up until the source changes or it's dismissed, so it's there
 * when the streamer comes back to the app. Dismissing silences that window.
 */
export function useHiddenCursorHint(sourceId: string | null): [HiddenCursorHint | null, () => void] {
  const [hint, setHint] = useState<HiddenCursorHint | null>(null)
  const dismissed = useRef(new Set<string>())
  const sharingScreen = sourceId?.startsWith('screen:') ?? false

  useEffect(() => {
    setHint(null)
    if (!sharingScreen) return
    const api = window.api.capture.hiddenCursor
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = api.onChanged(({ hidden, windowId }) => {
      clearTimeout(timer)
      if (!hidden || !windowId || dismissed.current.has(windowId)) return
      timer = setTimeout(() => {
        void window.api.capture.listSources().then((sources) => {
          const game = sources.find((s) => s.id === windowId)
          if (active && game) setHint({ windowId, name: game.name })
        })
      }, HIDDEN_FOR_MS)
    })
    void api.watch()
    return () => {
      active = false
      clearTimeout(timer)
      off()
      void api.unwatch()
    }
  }, [sharingScreen, sourceId])

  const dismiss = (): void => {
    if (hint) dismissed.current.add(hint.windowId)
    setHint(null)
  }
  return [hint, dismiss]
}
