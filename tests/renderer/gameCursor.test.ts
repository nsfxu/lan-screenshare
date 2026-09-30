import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameCursorGuard } from '../../src/renderer/lib/gameCursor'
import type { Publisher } from '../../src/renderer/lib/publisher'
import type { CursorWatchState } from '../../src/shared/types'

const SCREEN = 'screen:0:0'
const DISPLAY = '111'
const GAME = 'window:42:0'

/** The publisher as GameCursorGuard sees it: what's captured, switching, 'stream' events. */
function fakePublisher() {
  let onStream: (() => void) | null = null
  const pub = {
    sourceId: SCREEN,
    fail: false,
    switches: [] as string[],
    switchVideo: vi.fn(async (id: string) => {
      if (pub.fail) throw new Error('not capturable')
      pub.switches.push(id)
      pub.sourceId = id
    }),
    on: (_event: string, cb: () => void) => {
      onStream = cb
      return () => (onStream = null)
    },
    /** The publisher switched by itself (the shared window closed). */
    endedBackToScreen() {
      pub.sourceId = SCREEN
      onStream?.()
    }
  }
  return pub
}

const state = (patch: Partial<CursorWatchState>): CursorWatchState => ({
  hidden: false,
  windowId: GAME,
  fullscreen: true,
  displayId: DISPLAY,
  ...patch
})
const inGame = state({ hidden: true })
const elsewhere = state({ windowId: 'window:7:0', fullscreen: false })

/** Let timers fire and the async switches they start settle. */
async function wait(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('GameCursorGuard', () => {
  let pub: ReturnType<typeof fakePublisher>
  let guard: GameCursorGuard

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      api: {
        system: { log: () => {} },
        capture: {
          listSources: async () => [
            { id: GAME, name: 'Deadlock', kind: 'window' },
            { id: 'window:9:0', name: 'Windowed game', kind: 'window' }
          ]
        }
      }
    })
    pub = fakePublisher()
    guard = new GameCursorGuard(pub as unknown as Publisher, SCREEN, DISPLAY, () => {})
  })

  afterEach(() => {
    guard.dispose()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shares a fullscreen game window while it hides the cursor, and the screen again after alt-tab', async () => {
    guard.update(inGame)
    await wait(900)
    expect(pub.switches).toEqual([])
    await wait(200)
    expect(pub.switches).toEqual([GAME])
    expect(guard.active).toEqual({ windowId: GAME, name: 'Deadlock' })

    // Game menus show the cursor; window capture shows it too, so stay.
    guard.update(state({ hidden: false }))
    await wait(2000)
    expect(pub.switches).toEqual([GAME])

    guard.update(elsewhere)
    await wait(500)
    expect(pub.switches).toEqual([GAME, SCREEN])
    expect(guard.active).toBeNull()
  })

  it('ignores the cursor flashing hidden briefly', async () => {
    guard.update(inGame)
    await wait(500)
    guard.update(state({ hidden: false }))
    await wait(2000)
    expect(pub.switchVideo).not.toHaveBeenCalled()
  })

  it('stays in the game through a quick focus flicker', async () => {
    guard.update(inGame)
    await wait(1100)
    guard.update(elsewhere)
    await wait(200)
    guard.update(inGame)
    await wait(1000)
    expect(pub.switches).toEqual([GAME])
  })

  it('leaves games on other displays alone', async () => {
    guard.update(state({ hidden: true, displayId: '222' }))
    await wait(2000)
    expect(pub.switchVideo).not.toHaveBeenCalled()
    expect(guard.hint).toBeNull()
  })

  it('only suggests sharing a windowed game, and stops after dismissing', async () => {
    const windowed = state({ hidden: true, windowId: 'window:9:0', fullscreen: false })
    guard.update(windowed)
    await wait(1100)
    expect(pub.switchVideo).not.toHaveBeenCalled()
    expect(guard.hint).toEqual({ windowId: 'window:9:0', name: 'Windowed game' })

    guard.dismissHint()
    expect(guard.hint).toBeNull()
    guard.update(state({ hidden: false }))
    guard.update(windowed)
    await wait(2000)
    expect(guard.hint).toBeNull()
  })

  it('keeps the screen for a game the user sent back', async () => {
    guard.update(inGame)
    await wait(1100)
    guard.keepScreen()
    await wait(0)
    expect(pub.switches).toEqual([GAME, SCREEN])

    guard.update(state({ hidden: false }))
    guard.update(inGame)
    await wait(2000)
    expect(pub.switches).toEqual([GAME, SCREEN])
  })

  it("doesn't retry a window that can't be captured", async () => {
    pub.fail = true
    guard.update(inGame)
    await wait(5000)
    expect(pub.switchVideo).toHaveBeenCalledTimes(1)
    expect(guard.active).toBeNull()
  })

  it('notices when the publisher went back to the screen by itself', async () => {
    guard.update(inGame)
    await wait(1100)
    expect(guard.active).not.toBeNull()
    pub.endedBackToScreen()
    expect(guard.active).toBeNull()
  })
})
