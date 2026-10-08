import type {
  AppInfo,
  CaptureSource,
  CreateRoomRequest,
  DiscoveredRoom,
  CursorWatchState,
  HostedRoom,
  NativeAudioFormat,
  NativeAudioOptions,
  ScreenPermission,
  Settings,
  SystemStats,
  UpdateRoomRequest,
  UpdateStatus
} from './types'
import type { PerfRendererOptions, PerfSample } from './perf'

export const IPC = {
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  listRooms: 'rooms:list',
  refreshRooms: 'rooms:refresh',
  resolveRoom: 'rooms:resolve',
  addManual: 'rooms:add-manual',
  removeManual: 'rooms:remove-manual',
  roomsChanged: 'rooms:changed',
  createRoom: 'host:create',
  updateRoom: 'host:update',
  closeRoom: 'host:close',
  getHosted: 'host:get',
  hostedChanged: 'host:changed',
  listSources: 'capture:list',
  selectSource: 'capture:select',
  audioSupported: 'capture:audio-supported',
  nativeAudioAvailable: 'native-audio:available',
  nativeAudioStart: 'native-audio:start',
  nativeAudioStop: 'native-audio:stop',
  nativeAudioData: 'native-audio:data',
  nativeAudioEnded: 'native-audio:ended',
  hiddenCursorAffected: 'hidden-cursor:affected',
  hiddenCursorWatch: 'hidden-cursor:watch',
  hiddenCursorUnwatch: 'hidden-cursor:unwatch',
  hiddenCursorChanged: 'hidden-cursor:changed',
  screenPermission: 'capture:permission',
  openPermissionSettings: 'capture:open-settings',
  systemStats: 'system:stats',
  appInfo: 'system:app-info',
  setViewerProtection: 'window:protect',
  setTitleBarColors: 'window:title-bar-colors',
  windowState: 'window:state',
  copyText: 'clipboard:write',
  openLogs: 'system:open-logs',
  updateStatus: 'update:status',
  updateGet: 'update:get',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateOpenPage: 'update:open-page',
  log: 'system:log',
  perfOptions: 'perf:options',
  perfSample: 'perf:sample'
} as const

export type WindowState = 'minimized' | 'restored' | 'focused' | 'blurred'

/** API exposed to the renderer as `window.api` by the preload script. */
export interface ScreenShareApi {
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
  }
  rooms: {
    list(): Promise<DiscoveredRoom[]>
    refresh(): Promise<void>
    /** Probe a host:port to get fresh info (and trust its certificate). */
    resolve(address: string, port: number, tls?: boolean): Promise<DiscoveredRoom>
    addManual(input: string): Promise<DiscoveredRoom>
    removeManual(key: string): Promise<void>
    onChanged(cb: (rooms: DiscoveredRoom[]) => void): () => void
  }
  host: {
    create(req: CreateRoomRequest): Promise<HostedRoom>
    update(req: UpdateRoomRequest): Promise<HostedRoom>
    close(): Promise<void>
    get(): Promise<HostedRoom | null>
    onChanged(cb: (room: HostedRoom | null) => void): () => void
  }
  capture: {
    listSources(): Promise<CaptureSource[]>
    /** Choose the source (and whether to include system audio) for the next getDisplayMedia(). */
    select(id: string, audio: boolean): Promise<void>
    audioSupported(): Promise<boolean>
    /**
     * Windows helper that captures system audio: from surround (5.1/7.1)
     * devices, or everything except Discord.
     */
    nativeAudio: {
      available(): Promise<boolean>
      start(options?: NativeAudioOptions): Promise<NativeAudioFormat>
      stop(id?: number): Promise<void>
      /** Interleaved float32 stereo PCM, frame-aligned. */
      onData(cb: (id: number, chunk: Uint8Array) => void): () => void
      /** The helper exited on its own (device removed, crash); not sent after stop(). */
      onEnded(cb: (id: number, reason: string) => void): () => void
    }
    /**
     * Screen capture on Windows before 11 24H2 shows the mouse cursor even
     * when a game hides it (window capture doesn't).
     */
    hiddenCursor: {
      /** Whether this system is affected. */
      affected(): Promise<boolean>
      /** Report cursor visibility and the foreground window (Windows); false when unavailable. */
      watch(): Promise<boolean>
      unwatch(): Promise<void>
      onChanged(cb: (state: CursorWatchState) => void): () => void
    }
    permission(): Promise<ScreenPermission>
    openPermissionSettings(): Promise<void>
  }
  update: {
    get(): Promise<UpdateStatus>
    /** Look now, even with automatic checks turned off. */
    check(): Promise<UpdateStatus>
    /** Restart into the downloaded version (Windows, when `ready`). */
    install(): Promise<void>
    /** Open the release page to download it by hand (macOS, when `available`). */
    openPage(): Promise<void>
    onChanged(cb: (status: UpdateStatus) => void): () => void
  }
  system: {
    stats(): Promise<SystemStats>
    info(): Promise<AppInfo>
    copyText(text: string): Promise<void>
    openLogs(): Promise<void>
    setViewerProtection(enabled: boolean): Promise<void>
    /** Colours of the system's window buttons over our title bar (Windows, Linux), as #rrggbb. */
    setTitleBarColors(color: string, symbolColor: string): Promise<void>
    onWindowState(cb: (state: WindowState) => void): () => void
    log(level: 'info' | 'warn' | 'error', message: string): void
  }
  /** Measuring mode (`--perf-log`, `--perf-view-height`); does nothing without those switches. */
  perf: {
    readonly options: PerfRendererOptions
    /** Appended to the --perf-log file as one JSON line. */
    log(sample: PerfSample): void
  }
}
