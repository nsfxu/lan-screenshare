import { useEffect, useReducer, useState } from 'react'
import type { CursorWatchState } from '../../shared/types'
import { watchForeground } from './foregroundWatch'
import { errorMessage } from './format'
import type { Publisher } from './publisher'

/** How long the cursor must stay hidden before acting (games flash it in menus). */
const HIDDEN_FOR_MS = 1000
/** How long another window must be in front before going back to the screen. */
const AWAY_FOR_MS = 400

export interface GameWindow {
  /** Capture source id of the game's window. */
  windowId: string
  name: string
}

const log = (msg: string): void => window.api.system.log('info', `[game-cursor] ${msg}`)

/**
 * On Windows before 11 24H2, screen capture shows the mouse cursor even when
 * a game hides it (see main/cursorWatch.ts); window capture doesn't. While the
 * user shares a screen:
 *  - a fullscreen game on that screen that hides the cursor gets its window
 *    shared in place of the screen (video only; viewers see the same picture,
 *    minus the cursor). The screen comes back as soon as another window is in
 *    front (alt-tab);
 *  - a windowed game on that screen that hides it gets a suggestion to share
 *    its window instead, since switching would change what viewers see.
 */
export class GameCursorGuard {
  /** Game whose window is shared in place of the screen right now. */
  active: GameWindow | null = null
  /** Windowed game hiding the cursor: suggest sharing its window. */
  hint: GameWindow | null = null
  private latest: CursorWatchState | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private switching = false
  private disposed = false
  /** Games the user kept on the screen, dismissed, or whose window couldn't be captured. */
  private readonly declined = new Set<string>()
  private readonly names = new Map<string, string>()
  private readonly offStream: () => void

  constructor(
    private readonly publisher: Publisher,
    private readonly screenId: string,
    private readonly displayId: string | null,
    private readonly changed: () => void
  ) {
    // The publisher went back to the screen by itself (the game's window closed).
    this.offStream = publisher.on('stream', () => {
      if (this.active && publisher.sourceId !== this.active.windowId) this.set(null, this.hint)
    })
  }

  update(state: CursorWatchState): void {
    this.latest = state
    clearTimeout(this.timer)
    if (this.switching || this.disposed) return
    if (this.active) {
      // In the game's menus the cursor shows, and window capture shows it too:
      // only leaving the game ends it.
      if (state.windowId !== this.active.windowId) this.timer = setTimeout(() => void this.toScreen(), AWAY_FOR_MS)
      return
    }
    const { hidden, windowId, fullscreen, displayId } = state
    if (!hidden || !windowId || displayId !== this.displayId || this.declined.has(windowId)) return
    if (this.hint?.windowId === windowId) return
    this.timer = setTimeout(() => void (fullscreen ? this.toWindow(windowId) : this.suggest(windowId)), HIDDEN_FOR_MS)
  }

  /** Go back to sharing the screen, and stay there for this game. */
  keepScreen(): void {
    if (!this.active) return
    this.declined.add(this.active.windowId)
    clearTimeout(this.timer)
    void this.toScreen()
  }

  dismissHint(): void {
    if (this.hint) this.declined.add(this.hint.windowId)
    this.set(this.active, null)
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.offStream()
  }

  private async toWindow(windowId: string): Promise<void> {
    const name = await this.windowName(windowId)
    if (!name) {
      this.declined.add(windowId)
      return
    }
    await this.run(async () => {
      log(`${name} hides the cursor: sharing its window in place of the screen`)
      try {
        await this.publisher.switchVideo(windowId)
      } catch (err) {
        this.declined.add(windowId)
        throw err
      }
      this.set({ windowId, name }, null)
    })
  }

  private async toScreen(): Promise<void> {
    if (!this.active) return
    await this.run(async () => {
      log(`${this.active?.name} left: sharing the screen again`)
      await this.publisher.switchVideo(this.screenId)
      this.set(null, this.hint)
    })
  }

  private async suggest(windowId: string): Promise<void> {
    const name = await this.windowName(windowId)
    if (name && !this.disposed && !this.active) this.set(null, { windowId, name })
  }

  /** One switch at a time; afterwards, act on whatever changed meanwhile. */
  private async run(fn: () => Promise<void>): Promise<void> {
    if (this.disposed) return
    this.switching = true
    try {
      await fn()
    } catch (err) {
      log(`switch failed: ${errorMessage(err)}`)
    } finally {
      this.switching = false
      if (this.latest && !this.disposed) this.update(this.latest)
    }
  }

  private async windowName(windowId: string): Promise<string | null> {
    const known = this.names.get(windowId)
    if (known) return known
    const source = (await window.api.capture.listSources()).find((s) => s.id === windowId)
    if (source) this.names.set(windowId, source.name)
    return source?.name ?? null
  }

  private set(active: GameWindow | null, hint: GameWindow | null): void {
    if (this.disposed) return
    this.active = active
    this.hint = hint
    this.changed()
  }
}

/** A GameCursorGuard while `chosenSourceId` is a screen on an affected system. */
export function useGameCursor(publisher: Publisher, chosenSourceId: string | null): GameCursorGuard | null {
  const [guard, setGuard] = useState<GameCursorGuard | null>(null)
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!chosenSourceId?.startsWith('screen:')) return
    const api = window.api.capture.hiddenCursor
    let alive = true
    let current: GameCursorGuard | null = null
    let off = (): void => {}
    void (async () => {
      if (!(await api.affected())) return
      const screen = (await window.api.capture.listSources()).find((s) => s.id === chosenSourceId)
      if (!alive) return
      current = new GameCursorGuard(publisher, chosenSourceId, screen?.displayId ?? null, rerender)
      setGuard(current)
      off = watchForeground((state) => current?.update(state))
    })()
    return () => {
      alive = false
      off()
      current?.dispose()
      setGuard(null)
    }
  }, [publisher, chosenSourceId])

  return guard
}
