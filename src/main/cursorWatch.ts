import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, screen, type WebContents } from 'electron'
import { IPC } from '../shared/ipc'
import type { CursorWatchState } from '../shared/types'
import type { Logger } from './server'

/** Windows 11 24H2: Chromium captures screens with Windows.Graphics.Capture from here on. */
const WGC_SCREEN_CAPTURE_BUILD = 26100

/**
 * Chromium draws the mouse cursor into screen captures itself on Windows
 * before 11 24H2 (DXGI capture + WebRTC's cursor composer), and when an app
 * hides the cursor it draws a default arrow instead of nothing. Viewers then
 * see a cursor moving over a game that hides it. Window capture
 * (Windows.Graphics.Capture) lets Windows draw the real cursor state, so the
 * app shares a fullscreen game's window in place of the screen while it hides
 * the cursor (see renderer/lib/gameCursor.ts).
 *
 * While a screen is shared, the bundled helper (native/win-cursor-watch)
 * reports whether the cursor is hidden and which window is in the foreground,
 * whether it fills its display, and which display that is.
 */
export class CursorWatch {
  private child: ChildProcessWithoutNullStreams | null = null

  constructor(private readonly log: Logger) {}

  private get exePath(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'win-cursor-watch.exe')
      : path.join(app.getAppPath(), 'native', 'bin', 'win-cursor-watch.exe')
  }

  /** Whether screen capture on this system shows the cursor when apps hide it. */
  affected(): boolean {
    if (process.platform !== 'win32') return false
    const build = Number(os.release().split('.')[2])
    return Number.isFinite(build) && build < WGC_SCREEN_CAPTURE_BUILD
  }

  /**
   * Start reporting to `target`; false when this system can't (not Windows,
   * helper missing). Runs on every Windows: the game-cursor switch only acts
   * when affected(), but automatic quality uses the foreground window too.
   */
  start(target: WebContents): boolean {
    if (this.child) return true
    if (process.platform !== 'win32' || !fs.existsSync(this.exePath)) return false
    const child = spawn(this.exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    let pending = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const state = parseLine(line.trim())
        if (state && !target.isDestroyed()) target.send(IPC.hiddenCursorChanged, state)
      }
    })
    child.stderr.on('data', (d: Buffer) => this.log.warn(`[cursor-watch] ${d.toString().trim()}`))
    child.on('error', (err) => this.log.warn('[cursor-watch] failed to start', err))
    child.on('exit', (code) => {
      if (this.child === child) {
        this.child = null
        this.log.warn(`[cursor-watch] exited with code ${code}`)
      }
    })
    return true
  }

  stop(): void {
    const child = this.child
    this.child = null
    child?.stdin.end()
  }
}

/** "<hidden|visible> <hwnd> <fullscreen 0|1> <monitor centre x> <y>" (physical pixels). */
function parseLine(line: string): CursorWatchState | null {
  const m = /^(hidden|visible) (\d+) ([01]) (-?\d+) (-?\d+)$/.exec(line)
  if (!m) return null
  const hidden = m[1] === 'hidden'
  if (m[2] === '0') return { hidden, windowId: null, fullscreen: false, displayId: null }
  const display = screen.getDisplayNearestPoint(screen.screenToDipPoint({ x: Number(m[4]), y: Number(m[5]) }))
  return {
    hidden,
    // desktopCapturer's id for a top-level window is "window:<HWND>:0".
    windowId: `window:${m[2]}:0`,
    fullscreen: m[3] === '1',
    displayId: String(display.id)
  }
}
