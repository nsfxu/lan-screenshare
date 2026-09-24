import type {
  AppInfo,
  CaptureSource,
  CreateRoomRequest,
  DiscoveredRoom,
  HostedRoom,
  NativeAudioFormat,
  ScreenPermission,
  Settings,
  SystemStats,
  UpdateRoomRequest
} from './types'

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
  screenPermission: 'capture:permission',
  openPermissionSettings: 'capture:open-settings',
  systemStats: 'system:stats',
  appInfo: 'system:app-info',
  setViewerProtection: 'window:protect',
  windowState: 'window:state',
  copyText: 'clipboard:write',
  openLogs: 'system:open-logs',
  log: 'system:log'
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
    /** Windows helper that captures system audio from surround (5.1/7.1) devices. */
    nativeAudio: {
      available(): Promise<boolean>
      start(): Promise<NativeAudioFormat>
      stop(id?: number): Promise<void>
      /** Interleaved float32 stereo PCM, frame-aligned. */
      onData(cb: (id: number, chunk: Uint8Array) => void): () => void
      /** The helper exited on its own (device removed, crash); not sent after stop(). */
      onEnded(cb: (id: number, reason: string) => void): () => void
    }
    permission(): Promise<ScreenPermission>
    openPermissionSettings(): Promise<void>
  }
  system: {
    stats(): Promise<SystemStats>
    info(): Promise<AppInfo>
    copyText(text: string): Promise<void>
    openLogs(): Promise<void>
    setViewerProtection(enabled: boolean): Promise<void>
    onWindowState(cb: (state: WindowState) => void): () => void
    log(level: 'info' | 'warn' | 'error', message: string): void
  }
}
