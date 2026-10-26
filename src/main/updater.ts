import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { app, net, shell } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { RELEASES_REPO, RELEASES_URL, UPDATE_CHECK_INTERVAL_MS } from '../shared/constants'
import type { UpdateStatus } from '../shared/types'
import { macCanUpdateItself, releasePage } from '../shared/updates'
import { newerRelease } from '../shared/version'
import { mainT } from './i18n'
import type { Logger } from './server'

const FIRST_CHECK_DELAY_MS = 15_000

export interface UpdaterEvents {
  status: [status: UpdateStatus]
}

/**
 * Keeps the app up to date from the project's GitHub releases, the only
 * place the app contacts on the internet (and only while Settings allows).
 *
 * - Windows: electron-updater reads the release's latest.yml, downloads the
 *   installer for this computer's architecture in the background (checked
 *   against its SHA-512), and waits: the person restarts when it suits them.
 *   Nothing installs by itself when the app closes.
 * - macOS, signed with the project's certificate and in Applications: the
 *   same, from latest-mac.yml and the release's zip; Squirrel.Mac installs it
 *   on the restart (shared/updates.ts says why it needs both).
 * - Other Macs (ad-hoc builds, or run from the disk image): we only ask GitHub
 *   for the latest release and offer its page. So does a Mac whose install
 *   fails on the restart.
 */
export class Updater extends EventEmitter<UpdaterEvents> {
  private current: UpdateStatus
  private timer: NodeJS.Timeout | null = null
  private updater: AppUpdater | null = null
  /** Whether this Mac app can replace itself; asked once. */
  private macSelfUpdate: Promise<boolean> | null = null

  constructor(
    private readonly log: Logger,
    private readonly version: string,
    /** False in development builds, which have nothing to update. */
    private readonly supported: boolean,
    private readonly platform: NodeJS.Platform = process.platform
  ) {
    super()
    this.current = supported ? { state: 'idle', checkedAt: null } : { state: 'unsupported' }
  }

  get status(): UpdateStatus {
    return this.current
  }

  /** Checks shortly after start and then every few hours, while `enabled`. */
  setAutomatic(enabled: boolean): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!enabled || !this.supported) return
    const schedule = (delay: number): void => {
      this.timer = setTimeout(() => {
        void this.check(false).finally(() => schedule(UPDATE_CHECK_INTERVAL_MS))
      }, delay)
      this.timer.unref()
    }
    schedule(FIRST_CHECK_DELAY_MS)
  }

  /** Looks for a new version now. Errors are only shown when someone asked (`manual`). */
  async check(manual = true): Promise<UpdateStatus> {
    if (!this.supported) return this.current
    // A download in progress or waiting for a restart has nothing new to learn.
    if (this.current.state === 'downloading' || this.current.state === 'ready' || this.current.state === 'checking') {
      return this.current
    }
    this.set({ state: 'checking' })
    try {
      if (this.platform === 'win32' || (this.platform === 'darwin' && (await this.canMacUpdateItself()))) {
        await this.checkWithUpdater()
      } else await this.checkByRelease()
    } catch (err) {
      const message = (err as Error).message
      this.log.warn(`update check failed: ${message}`)
      this.set(manual ? { state: 'error', message: mainT('update.checkFailed') } : { state: 'idle', checkedAt: null })
    }
    return this.current
  }

  /** Restarts into the downloaded version. */
  install(): void {
    if (this.current.state !== 'ready' || !this.updater) return
    this.log.info(`restarting to install ${this.current.version}`)
    // Silent install (the installer already knows where the app is), then start the app again. On macOS,
    // Squirrel.Mac checks the new version's signature now, and quits once it's in place (or fails: see 'error').
    this.updater.quitAndInstall(true, true)
  }

  /** Opens the release page in the browser (only ever our own releases page). */
  async openPage(): Promise<void> {
    const url = this.current.state === 'available' ? this.current.url : RELEASES_URL
    if (url.startsWith(`${RELEASES_URL}/`) || url === RELEASES_URL) await shell.openExternal(url)
  }

  private set(status: UpdateStatus): void {
    this.current = status
    this.emit('status', status)
  }

  private async checkWithUpdater(): Promise<void> {
    const updater = this.electronUpdater()
    const result = await updater.checkForUpdates()
    // checkForUpdates() resolves once it knows; the download goes on through the events below.
    if (!result?.isUpdateAvailable) this.set({ state: 'idle', checkedAt: Date.now() })
  }

  private electronUpdater(): AppUpdater {
    if (this.updater) return this.updater
    // Loaded only when needed: it isn't used in development or on Macs that can't update themselves.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    autoUpdater.autoDownload = true
    // The person chooses when to restart; closing the app doesn't install anything.
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    // We ship full installers, never the small web installer that downloads the app.
    autoUpdater.disableWebInstaller = true
    autoUpdater.logger = {
      info: (m: unknown) => this.log.info(`updater: ${String(m)}`),
      warn: (m: unknown) => this.log.warn(`updater: ${String(m)}`),
      error: (m: unknown) => this.log.warn(`updater: ${String(m)}`),
      debug: () => {}
    }
    autoUpdater.on('update-available', (info) => this.set({ state: 'downloading', version: info.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) => {
      if (this.current.state === 'downloading') this.set({ ...this.current, percent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.log.info(`update ${info.version} downloaded, waiting for a restart`)
      this.set({ state: 'ready', version: info.version })
    })
    autoUpdater.on('error', (err) => {
      this.log.warn(`updater error: ${err.message}`)
      // A failed download is tried again at the next check.
      if (this.current.state === 'downloading') this.set({ state: 'idle', checkedAt: null })
      // macOS: Squirrel.Mac refused to install it (on the restart). Offer it to download instead.
      else if (this.current.state === 'ready' && this.platform === 'darwin') {
        this.set({ state: 'available', version: this.current.version, url: releasePage(this.current.version) })
      }
    })
    this.updater = autoUpdater
    return autoUpdater
  }

  private canMacUpdateItself(): Promise<boolean> {
    this.macSelfUpdate ??= this.readMacSelfUpdate()
    return this.macSelfUpdate
  }

  private async readMacSelfUpdate(): Promise<boolean> {
    // ScreenShare.app, from ScreenShare.app/Contents/MacOS/ScreenShare.
    const bundle = path.resolve(process.execPath, '..', '..', '..')
    const requirement = await new Promise<string>((resolve) => {
      execFile('/usr/bin/codesign', ['-dr', '-', bundle], { timeout: 10_000 }, (err, stdout, stderr) =>
        resolve(err ? '' : `${stdout}${stderr}`)
      )
    })
    const can = macCanUpdateItself(requirement, app.isInApplicationsFolder())
    this.log.info(`macOS updates: ${can ? 'installs them itself' : 'offers the download page'}`)
    return can
  }

  private async checkByRelease(): Promise<void> {
    const res = await net.fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' }
    })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const release = (await res.json()) as { tag_name?: unknown; html_url?: unknown }
    const version = newerRelease(release.tag_name, this.version)
    const url = typeof release.html_url === 'string' && release.html_url.startsWith(`${RELEASES_URL}/`) ? release.html_url : RELEASES_URL
    this.set(version ? { state: 'available', version, url } : { state: 'idle', checkedAt: Date.now() })
  }
}
