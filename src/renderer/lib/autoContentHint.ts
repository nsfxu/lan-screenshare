import { useEffect } from 'react'
import { autoContentHint } from '../../shared/quality'
import type { ContentHintSetting } from '../../shared/types'
import { watchForeground } from './foregroundWatch'
import type { Publisher } from './publisher'

/** How long what's in front must stay the same before switching (alt-tab flickers). */
const SETTLE_MS = 1000

/**
 * "Optimize for: Automatic": while sharing, keep the video on smooth motion
 * while a fullscreen window (a game, a video) is in front of what's shared,
 * and on sharp text otherwise (see autoContentHint). Uses the Windows
 * foreground helper; elsewhere the publisher keeps its fallback (motion).
 */
export function useAutoContentHint(publisher: Publisher, chosenSourceId: string | null, setting: ContentHintSetting): void {
  useEffect(() => {
    if (!chosenSourceId || setting !== 'auto') return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let off = (): void => {}
    void (async () => {
      const displayId = chosenSourceId.startsWith('screen:')
        ? ((await window.api.capture.listSources()).find((s) => s.id === chosenSourceId)?.displayId ?? null)
        : null
      if (!alive) return
      off = watchForeground((state) => {
        clearTimeout(timer)
        const hint = autoContentHint(state, chosenSourceId, displayId)
        timer = setTimeout(() => publisher.setAutoContentHint(hint), SETTLE_MS)
      })
    })()
    return () => {
      alive = false
      clearTimeout(timer)
      off()
      publisher.setAutoContentHint(null)
    }
  }, [publisher, chosenSourceId, setting])
}
