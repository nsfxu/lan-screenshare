import { desktopCapturer, screen, shell, systemPreferences, type Session } from 'electron'
import type { CaptureSource, ScreenPermission } from '../shared/types'
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
 */
export class ScreenCapture {
  private selectedId: string | null = null
  private withAudio = false

  constructor(private readonly log: Logger) {}

  install(session: Session): void {
    session.setDisplayMediaRequestHandler(
      (_request, callback) => {
        desktopCapturer
          .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
          .then((sources) => {
            const source =
              sources.find((s) => s.id === this.selectedId) ?? sources.find((s) => s.id.startsWith('screen:'))
            if (!source) {
              this.log.warn('no capture source available')
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
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false
    })
    const displays = screen.getAllDisplays()
    return sources
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
