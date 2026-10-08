import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, screen, session, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { APP_NAME, DEFAULT_PORT, STREAM_WINDOW_PREFIX, TITLE_BAR_HEIGHT } from '../shared/constants'
import { IPC } from '../shared/ipc'
import { parsePerfArgs, type PerfRendererOptions } from '../shared/perf'
import { cpuBusyPercent, type CpuTimes } from '../shared/systemStats'
import type { AppInfo, CreateRoomRequest, NativeAudioOptions, Settings, SystemStats, UpdateRoomRequest } from '../shared/types'
import { parseHostPort } from '../utils/network'
import { createFileLogger } from './logger'
import { CursorWatch } from './cursorWatch'
import { NativeLoopback } from './nativeAudio'
import { Updater } from './updater'
import { RoomManager } from './roomManager'
import { ScreenCapture } from './screenCapture'
import { SettingsStore } from './settings'
import { parsePlacement, tileBounds, type Placement, type Rect } from './windowPlacement'

app.setName(APP_NAME)

// `--profile=<name>` runs an isolated instance (own settings and identity),
// handy for testing host + viewer on a single machine.
const profileArg = process.argv.find((a) => a.startsWith('--profile='))
if (profileArg) {
  const profile = profileArg.slice('--profile='.length).replace(/[^\w-]/g, '')
  if (profile) app.setPath('userData', path.join(app.getPath('appData'), `${APP_NAME}-${profile}`))
}

// `--perf-log=<file>` and `--perf-view-height=<px>`: measuring mode for `npm run perf`.
const perf = parsePerfArgs(process.argv)

// --- Chromium switches -------------------------------------------------------
// LAN-only WebRTC: expose real host candidates instead of obfuscated mDNS
// names (those don't resolve across VPNs), and never throttle a minimized or
// occluded window that is capturing/encoding.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns,CalculateNativeWinOcclusion')
// Allow H.265 in WebRTC where the platform has a hardware codec for it. On
// macOS, also enable system-audio loopback for screen sharing (ScreenCaptureKit,
// macOS 13+), which Chromium keeps behind feature flags.
const enabledFeatures = ['WebRtcAllowH265Send', 'WebRtcAllowH265Receive']
if (process.platform === 'darwin') enabledFeatures.push('MacLoopbackAudioForScreenShare', 'MacSckSystemAudioLoopbackOverride')
app.commandLine.appendSwitch('enable-features', enabledFeatures.join(','))
// Send big frames faster. WebRTC sends a keyframe every 3000 frames on its own (~50 s at 60 fps) and paces
// packets at only 1.0x (screen content) or 1.1x (video) its target bitrate, so a keyframe of a detailed 1080p
// desktop took ~0.2-0.9 s to arrive and the picture froze meanwhile. At 10x the same keyframes arrive without a
// freeze (measured with `npm run perf`, see docs/en-US/media-pipeline.md). Screen content keeps WebRTC's other
// defaults ("1.0,2875,80,40,-60,3" in rtc_base/experiments/alr_experiment.cc). A --force-fieldtrials given on
// the command line (perf experiments) replaces ours.
if (!process.argv.some((a) => a.startsWith('--force-fieldtrials='))) {
  app.commandLine.appendSwitch(
    'force-fieldtrials',
    'WebRTC-ProbingScreenshareBwe/10.0,2875,80,40,-60,3/WebRTC-Video-Pacing/factor:10.0/'
  )
}
// Let viewers hear the stream without clicking first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

const logDir = process.platform === 'win32' ? path.join(app.getPath('userData'), 'logs') : app.getPath('logs')
/** Small enough to sit snapped beside a game on a laptop screen; the layout adapts below 1100 px. */
const MIN_WINDOW_WIDTH = 640
const MIN_WINDOW_HEIGHT = 480

const log = createFileLogger(logDir, !app.isPackaged)
const settings = new SettingsStore(app.getPath('userData'))
const rooms = new RoomManager(settings, app.getPath('userData'), log, app.getVersion())
const capture = new ScreenCapture(log)
const updater = new Updater(log, app.getVersion(), app.isPackaged)
const nativeAudio = new NativeLoopback(log)
const cursorWatch = new CursorWatch(log)

let mainWindow: BrowserWindow | null = null
let quitting = false
/** Hide the app's windows from screen capture (while watching), see setViewerProtection. */
let viewerProtection = false

process.on('uncaughtException', (err) => log.error('uncaught exception', err))
process.on('unhandledRejection', (err) => log.error('unhandled rejection', err))

/** Where `--display`/`--tile` put the window (see windowPlacement.ts); null if that screen doesn't exist. */
async function placedBounds(placement: Placement): Promise<Rect | null> {
  try {
    // Screens numbered like the source picker ("Screen 3" is screen:2:0).
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    const displayId = sources.find((s) => s.id.startsWith(`screen:${placement.display - 1}:`))?.display_id
    const display = screen.getAllDisplays().find((d) => String(d.id) === displayId)
    if (display) return tileBounds(display.workArea, placement.tile, placement.tiles)
    log.warn(`--display=${placement.display}: no such screen`)
  } catch (err) {
    log.warn('window placement failed', err)
  }
  return null
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    // Our own title bar: the system draws its window buttons over it (macOS:
    // the traffic lights inside it, on the left), recoloured with the theme.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 9 } }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: '#0f1115', symbolColor: '#e7e9ee', height: TITLE_BAR_HEIGHT }
        }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  mainWindow = win

  const placement = parsePlacement(process.argv)
  const bounds = placement ? placedBounds(placement) : null
  win.once('ready-to-show', () => {
    if (!placement) return win.show()
    void bounds!.then((rect) => {
      if (win.isDestroyed()) return
      if (rect) {
        win.setMinimumSize(Math.min(MIN_WINDOW_WIDTH, rect.width), Math.min(MIN_WINDOW_HEIGHT, rect.height))
        win.setBounds(rect)
      }
      win.showInactive()
    })
  })
  // The only window the page may open is a stream's own window: a blank page the room
  // fills in (same process, so it can play the stream it already receives).
  win.webContents.setWindowOpenHandler(({ url, frameName }) =>
    url === 'about:blank' && frameName.startsWith(STREAM_WINDOW_PREFIX)
      ? {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 1280,
            height: 760,
            minWidth: 320,
            minHeight: 200,
            backgroundColor: '#000000',
            autoHideMenuBar: true,
            title: APP_NAME
          }
        }
      : { action: 'deny' }
  )
  win.webContents.on('did-create-window', (child) => {
    child.setContentProtection(viewerProtection)
    child.setMenuBarVisibility(false)
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    child.webContents.on('will-navigate', (e) => e.preventDefault())
    // A stream's window doesn't outlive the room's window.
    win.once('closed', () => {
      if (!child.isDestroyed()) child.close()
    })
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })

  const sendState = (state: string): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.windowState, state)
  }
  win.on('minimize', () => sendState('minimized'))
  win.on('restore', () => sendState('restored'))
  win.on('focus', () => sendState('focused'))
  win.on('blur', () => sendState('blurred'))

  // Closing the window while hosting ends the room (after confirmation) so
  // viewers are told instead of timing out.
  win.on('close', (e) => {
    if (quitting || !rooms.getHosted()) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['End room and quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'End room?',
      message: 'You are hosting a room.',
      detail: 'Closing ScreenShare ends the room and disconnects all viewers.'
    })
    if (choice !== 0) {
      e.preventDefault()
      return
    }
    e.preventDefault()
    quitting = true
    void rooms.closeRoom().finally(() => win.destroy())
  })
  win.on('closed', () => {
    mainWindow = null
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getSettings, () => settings.get())
  ipcMain.handle(IPC.updateSettings, (_e, patch: Partial<Settings>) => {
    const next = settings.update(patch)
    if (patch && 'autoUpdate' in patch) updater.setAutomatic(next.autoUpdate)
    return next
  })
  ipcMain.handle(IPC.updateGet, () => updater.status)
  ipcMain.handle(IPC.updateCheck, () => updater.check(true))
  ipcMain.handle(IPC.updateInstall, () => updater.install())
  ipcMain.handle(IPC.updateOpenPage, () => updater.openPage())

  ipcMain.handle(IPC.listRooms, () => rooms.listRooms())
  ipcMain.handle(IPC.refreshRooms, () => rooms.refresh())
  ipcMain.handle(IPC.resolveRoom, (_e, address: string, port: number, tls?: boolean) =>
    rooms.resolve(String(address), Number(port), tls)
  )
  ipcMain.handle(IPC.addManual, (_e, input: string) => {
    const parsed = parseHostPort(String(input), DEFAULT_PORT)
    if (!parsed) throw new Error('Enter an address like 192.168.1.20 or 10.8.0.5:47800')
    return rooms.addManual(parsed.address, parsed.port)
  })
  ipcMain.handle(IPC.removeManual, (_e, key: string) => rooms.removeManual(String(key)))

  ipcMain.handle(IPC.createRoom, (_e, req: CreateRoomRequest) => rooms.createRoom(req))
  ipcMain.handle(IPC.updateRoom, (_e, req: UpdateRoomRequest) => rooms.updateRoom(req))
  ipcMain.handle(IPC.closeRoom, () => rooms.closeRoom())
  ipcMain.handle(IPC.getHosted, () => rooms.getHosted())

  ipcMain.handle(IPC.listSources, () => capture.listSources())
  ipcMain.handle(IPC.selectSource, (_e, id: string, audio: boolean) => capture.select(String(id), !!audio))
  ipcMain.handle(IPC.audioSupported, () => capture.audioSupported())
  ipcMain.handle(IPC.nativeAudioAvailable, () => nativeAudio.available())
  ipcMain.handle(IPC.nativeAudioStart, (e, options?: NativeAudioOptions) =>
    nativeAudio.start(e.sender, {
      excludeDiscord: options?.excludeDiscord === true,
      appWindow: typeof options?.appWindow === 'string' && /^window:\d+:\d+$/.test(options.appWindow) ? options.appWindow : null
    })
  )
  ipcMain.handle(IPC.nativeAudioStop, (_e, id?: number) => nativeAudio.stop(typeof id === 'number' ? id : undefined))
  ipcMain.handle(IPC.hiddenCursorAffected, () => cursorWatch.affected())
  ipcMain.handle(IPC.hiddenCursorWatch, (e) => cursorWatch.start(e.sender))
  ipcMain.handle(IPC.hiddenCursorUnwatch, () => cursorWatch.stop())
  ipcMain.handle(IPC.screenPermission, () => capture.permission())
  ipcMain.handle(IPC.openPermissionSettings, () => capture.openPermissionSettings())

  // The whole computer's CPU is measured between two calls (the streamer's stats ask every second).
  let lastCpuTimes: CpuTimes[] = []
  ipcMain.handle(IPC.systemStats, (): SystemStats => {
    // percentCPUUsage is already relative to the whole machine (all cores).
    const metrics = app.getAppMetrics()
    const cpu = metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0)
    const memKB = metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0)
    const cpuTimes = os.cpus().map((c) => c.times)
    const computerCpuPercent = cpuBusyPercent(lastCpuTimes, cpuTimes)
    lastCpuTimes = cpuTimes
    // In KB; "free" is what applications could still get, so in use is the rest.
    const memory = process.getSystemMemoryInfo()
    return {
      cpuPercent: Math.round(cpu * 10) / 10,
      memoryMB: Math.round(memKB / 1024),
      computerCpuPercent,
      computerMemoryMB: Math.round((memory.total - memory.free) / 1024),
      computerMemoryTotalMB: Math.round(memory.total / 1024)
    }
  })
  ipcMain.handle(
    IPC.appInfo,
    (): AppInfo => ({ version: app.getVersion(), platform: process.platform, logDir: log.dir })
  )
  ipcMain.handle(IPC.copyText, (_e, text: string) => clipboard.writeText(String(text)))
  ipcMain.handle(IPC.openLogs, () => shell.openPath(log.dir))
  ipcMain.handle(IPC.setTitleBarColors, (e, color: unknown, symbolColor: unknown) => {
    const hex = /^#[0-9a-f]{6}$/i
    if (process.platform === 'darwin' || typeof color !== 'string' || typeof symbolColor !== 'string') return
    if (!hex.test(color) || !hex.test(symbolColor)) return
    try {
      BrowserWindow.fromWebContents(e.sender)?.setTitleBarOverlay({ color, symbolColor, height: TITLE_BAR_HEIGHT })
    } catch (err) {
      log.debug('title bar colours not applied', err)
    }
  })
  // Viewers are not allowed to record the stream: hide the window from OS
  // screen capture/screenshots while watching.
  ipcMain.handle(IPC.setViewerProtection, (_e, enabled: boolean) => {
    viewerProtection = !!enabled
    // The room's window and any stream's own window.
    for (const w of BrowserWindow.getAllWindows()) w.setContentProtection(viewerProtection)
  })
  ipcMain.on(IPC.log, (_e, level: 'info' | 'warn' | 'error', message: string) => {
    const fn = log[level] ?? log.info
    fn(`[renderer] ${String(message).slice(0, 2000)}`)
  })

  ipcMain.on(IPC.perfOptions, (e) => {
    const options: PerfRendererOptions = { logging: !!perf.logFile, viewHeight: perf.viewHeight }
    e.returnValue = options
  })
  if (perf.logFile) {
    const file = path.resolve(perf.logFile)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const out = fs.createWriteStream(file, { flags: 'a' })
    out.on('error', (err) => log.warn('perf log not written', err))
    log.info(`perf log: ${file}`)
    ipcMain.on(IPC.perfSample, (_e, sample: unknown) => {
      if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return
      const line = JSON.stringify(sample)
      if (line.length <= 64_000) out.write(line + '\n')
    })
  }

  rooms.on('rooms', (list) => mainWindow?.webContents.send(IPC.roomsChanged, list))
  rooms.on('hosted', (hosted) => mainWindow?.webContents.send(IPC.hostedChanged, hosted))
  updater.on('status', (status) => mainWindow?.webContents.send(IPC.updateStatus, status))
}

function configureSession(): void {
  const ses = session.defaultSession
  capture.install(ses)

  const allowed = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write'])
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))

  // Rooms use self-signed certificates. Accept one only if its fingerprint was
  // advertised over mDNS or seen when probing that exact host.
  ses.setCertificateVerifyProc((request, callback) => {
    if (request.verificationResult === 'net::OK') return callback(-3)
    if (rooms.isTrustedCertificate(request.hostname, request.certificate.data)) return callback(0)
    log.warn(`rejected certificate for ${request.hostname}: ${request.verificationResult}`)
    callback(-3)
  })
}

app.whenReady().then(() => {
  log.info(`${APP_NAME} ${app.getVersion()} starting on ${process.platform} ${os.release()}`)
  configureSession()
  registerIpc()
  rooms.start()
  createWindow()
  updater.setAutomatic(settings.get().autoUpdate)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  nativeAudio.stop()
  cursorWatch.stop()
})

// Tell viewers the room is over and withdraw the mDNS advert before exiting.
let cleanedUp = false
app.on('will-quit', (e) => {
  if (cleanedUp) return
  e.preventDefault()
  const timeout = new Promise((resolve) => setTimeout(resolve, 3000))
  void Promise.race([rooms.stop(), timeout]).finally(() => {
    cleanedUp = true
    app.quit()
  })
})
