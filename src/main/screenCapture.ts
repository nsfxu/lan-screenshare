import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app, desktopCapturer, screen, shell, systemPreferences, type DesktopCapturerSource, type Session } from 'electron'
import type { CaptureSource, ScreenPermission } from '../shared/types'
import { offscreenWindows, parseNativeWindows, windowName, windowSourceId, type NativeWindow } from '../shared/windowList'
import type { Logger } from './server'

/**
 * Screen capture source selection.
 *
 * Capture itself runs in Chromium's capture stack, which uses the native
 * high-performance APIs on each platform:
 *   - Windows: DXGI Desktop Duplication for screens (GPU copy, no GDI), and
 *     Windows.Graphics.Capture for individual windows.
 *   - macOS: ScreenCaptureKit (macOS 12.3+).
 * Frames stay on the GPU and are handed to the hardware H.264/H.265 encoder
 * by WebRTC, which keeps CPU usage low at 1080p60.
 *
 * The renderer shows its own picker (listSources), tells us the choice
 * (select), then calls getDisplayMedia(); our display-media handler answers
 * with the chosen source instead of showing a system dialog.
 *
 * System audio uses loopback capture: WASAPI loopback on Windows (the whole
 * system mix, even when a single window is shared) and ScreenCaptureKit audio
 * on macOS 13+ (behind Chromium feature flags enabled in index.ts).
 *
 * On macOS, Chromium only lists the windows on the current desktop (Space).
 * native/mac-window-list lists the others, which Chromium captures fine when
 * given their id; the picker shows them with their app's icon (shared/windowList.ts).
 */
export class ScreenCapture {
  private selectedId: string | null = null
  private withAudio = false
  /** App icons of windows on other desktops, by bundle path. */
  private readonly icons = new Map<string, string>()

  constructor(private readonly log: Logger) {}

  install(session: Session): void {
    session.setDisplayMediaRequestHandler(
      (_request, callback) => {
        Promise.all([
          desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } }),
          this.nativeWindows()
        ])
          .then(([sources, windows]) => {
            // Never capture something other than what was chosen: a window can
            // be missing from the list (closed, or minimized like a fullscreen
            // game after alt-tab), and getDisplayMedia() should fail then.
            const source = this.selectedId
              ? (sources.find((s) => s.id === this.selectedId) ?? this.offscreenSource(this.selectedId, windows))
              : sources.find((s) => s.id.startsWith('screen:'))
            if (!source) {
              this.log.warn(`capture source not available: ${this.selectedId ?? 'no screen'}`)
              callback({})
              return
            }
            // Only offer audio when the page asked for it, or Chromium rejects the request.
            const audio = this.withAudio && _request.audioRequested ? ({ audio: 'loopback' } as const) : {}
            this.log.info(`capturing "${source.name}" (${source.id}) audio=${'audio' in audio}`)
            callback({ video: source, ...audio })
          })
          .catch((err: unknown) => {
            this.log.error('getSources failed', err)
            callback({})
          })
      },
      { useSystemPicker: false }
    )
  }

  async listSources(): Promise<CaptureSource[]> {
    const [sources, windows] = await Promise.all([
      desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: false
      }),
      this.nativeWindows()
    ])
    const displays = screen.getAllDisplays()
    const listed = sources
      .filter((s) => !s.thumbnail.isEmpty() || s.id.startsWith('screen:'))
      .map((s) => {
        const display = displays.find((d) => String(d.id) === s.display_id)
        return {
          id: s.id,
          name: s.name,
          kind: s.id.startsWith('screen:') ? ('screen' as const) : ('window' as const),
          thumbnail: s.thumbnail.toDataURL(),
          displayId: s.display_id,
          width: display ? Math.round(display.size.width * display.scaleFactor) : undefined,
          height: display ? Math.round(display.size.height * display.scaleFactor) : undefined
        }
      })
    const others = offscreenWindows(windows, new Set(listed.map((s) => s.id)), process.pid)
    const elsewhere = await Promise.all(
      others.map(async (w) => ({
        id: windowSourceId(w.id),
        name: windowName(w),
        kind: 'window' as const,
        thumbnail: '',
        displayId: '',
        offscreen: true,
        appIcon: w.bundle ? await this.appIcon(w.bundle) : undefined
      }))
    )
    return [...listed, ...elsewhere]
  }

  /** A window on another desktop that Chromium didn't list, if it's still there. */
  private offscreenSource(id: string, windows: NativeWindow[]): DesktopCapturerSource | undefined {
    const w = offscreenWindows(windows, new Set(), process.pid).find((x) => windowSourceId(x.id) === id)
    // Chromium only needs the id; the rest of a DesktopCapturerSource is for pickers.
    return w ? ({ id, name: windowName(w) } as DesktopCapturerSource) : undefined
  }

  private get windowListPath(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'mac-window-list')
      : path.join(app.getAppPath(), 'native', 'bin', 'mac-window-list')
  }

  /** Every window on every desktop (macOS, from native/mac-window-list); none elsewhere or if it fails. */
  private nativeWindows(): Promise<NativeWindow[]> {
    if (process.platform !== 'darwin' || !fs.existsSync(this.windowListPath)) return Promise.resolve([])
    return new Promise((resolve) => {
      execFile(this.windowListPath, { timeout: 3000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        try {
          if (err) throw err
          resolve(parseNativeWindows(stdout))
        } catch (e) {
          this.log.warn('listing the windows on other desktops failed', e)
          resolve([])
        }
      })
    })
  }

  /** The app's icon as a data URL (from native/mac-window-list), cached by bundle. */
  private appIcon(bundle: string): Promise<string | undefined> {
    const cached = this.icons.get(bundle)
    if (cached) return Promise.resolve(cached)
    return new Promise((resolve) => {
      execFile(this.windowListPath, ['--icon', bundle], { encoding: 'buffer', timeout: 3000 }, (err, stdout) => {
        if (err || stdout.length === 0) {
          resolve(undefined)
          return
        }
        const icon = `data:image/png;base64,${stdout.toString('base64')}`
        this.icons.set(bundle, icon)
        resolve(icon)
      })
    })
  }

  select(id: string, audio: boolean): void {
    this.selectedId = id
    this.withAudio = audio
  }

  /** Whether this platform can capture system audio at all. */
  audioSupported(): boolean {
    return process.platform === 'win32' || process.platform === 'darwin'
  }

  permission(): ScreenPermission {
    if (process.platform !== 'darwin') return 'granted'
    try {
      return systemPreferences.getMediaAccessStatus('screen') as ScreenPermission
    } catch {
      return 'unknown'
    }
  }

  openPermissionSettings(): void {
    if (process.platform === 'darwin') {
      void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    }
  }
}
