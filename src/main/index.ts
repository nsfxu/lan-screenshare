import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { APP_NAME, DEFAULT_PORT } from '../shared/constants'
import { IPC } from '../shared/ipc'
import type { AppInfo, CreateRoomRequest, Settings, SystemStats, UpdateRoomRequest } from '../shared/types'
import { parseHostPort } from '../utils/network'
import { createFileLogger } from './logger'
import { RoomManager } from './roomManager'
import { ScreenCapture } from './screenCapture'
import { SettingsStore } from './settings'

app.setName(APP_NAME)

// `--profile=<name>` runs an isolated instance (own settings and identity),
// handy for testing host + viewer on a single machine.
const profileArg = process.argv.find((a) => a.startsWith('--profile='))
if (profileArg) {
  const profile = profileArg.slice('--profile='.length).replace(/[^\w-]/g, '')
  if (profile) app.setPath('userData', path.join(app.getPath('appData'), `${APP_NAME}-${profile}`))
}

// --- Chromium switches -------------------------------------------------------
// LAN-only WebRTC: expose real host candidates instead of obfuscated mDNS
// names (those don't resolve across VPNs), and never throttle a minimized or
// occluded window that is capturing/encoding.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns,CalculateNativeWinOcclusion')
// Allow H.265 in WebRTC where the platform has a hardware codec for it.
app.commandLine.appendSwitch('enable-features', 'WebRtcAllowH265Send,WebRtcAllowH265Receive')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

const logDir = process.platform === 'win32' ? path.join(app.getPath('userData'), 'logs') : app.getPath('logs')
const log = createFileLogger(logDir, !app.isPackaged)
const settings = new SettingsStore(app.getPath('userData'))
const rooms = new RoomManager(settings, app.getPath('userData'), log)
const capture = new ScreenCapture(log)

let mainWindow: BrowserWindow | null = null
let quitting = false

process.on('uncaughtException', (err) => log.error('uncaught exception', err))
process.on('unhandledRejection', (err) => log.error('unhandled rejection', err))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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
  ipcMain.handle(IPC.updateSettings, (_e, patch: Partial<Settings>) => settings.update(patch))

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
  ipcMain.handle(IPC.selectSource, (_e, id: string) => capture.select(String(id)))
  ipcMain.handle(IPC.screenPermission, () => capture.permission())
  ipcMain.handle(IPC.openPermissionSettings, () => capture.openPermissionSettings())

  ipcMain.handle(IPC.systemStats, (): SystemStats => {
    // percentCPUUsage is already relative to the whole machine (all cores).
    const metrics = app.getAppMetrics()
    const cpu = metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0)
    const memKB = metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0)
    return { cpuPercent: Math.round(cpu * 10) / 10, memoryMB: Math.round(memKB / 1024) }
  })
  ipcMain.handle(
    IPC.appInfo,
    (): AppInfo => ({ version: app.getVersion(), platform: process.platform, logDir: log.dir })
  )
  ipcMain.handle(IPC.copyText, (_e, text: string) => clipboard.writeText(String(text)))
  ipcMain.handle(IPC.openLogs, () => shell.openPath(log.dir))
  // Viewers are not allowed to record the stream: hide the window from OS
  // screen capture/screenshots while watching.
  ipcMain.handle(IPC.setViewerProtection, (_e, enabled: boolean) => {
    mainWindow?.setContentProtection(!!enabled)
  })
  ipcMain.on(IPC.log, (_e, level: 'info' | 'warn' | 'error', message: string) => {
    const fn = log[level] ?? log.info
    fn(`[renderer] ${String(message).slice(0, 2000)}`)
  })

  rooms.on('rooms', (list) => mainWindow?.webContents.send(IPC.roomsChanged, list))
  rooms.on('hosted', (hosted) => mainWindow?.webContents.send(IPC.hostedChanged, hosted))
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => app.quit())

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
