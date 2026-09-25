import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type ScreenShareApi, type WindowState } from '../shared/ipc'
import type { DiscoveredRoom, HostedRoom } from '../shared/types'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ScreenShareApi = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.getSettings),
    update: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch)
  },
  rooms: {
    list: () => ipcRenderer.invoke(IPC.listRooms),
    refresh: () => ipcRenderer.invoke(IPC.refreshRooms),
    resolve: (address, port, tls) => ipcRenderer.invoke(IPC.resolveRoom, address, port, tls),
    addManual: (input) => ipcRenderer.invoke(IPC.addManual, input),
    removeManual: (key) => ipcRenderer.invoke(IPC.removeManual, key),
    onChanged: (cb) => subscribe<DiscoveredRoom[]>(IPC.roomsChanged, cb)
  },
  host: {
    create: (req) => ipcRenderer.invoke(IPC.createRoom, req),
    update: (req) => ipcRenderer.invoke(IPC.updateRoom, req),
    close: () => ipcRenderer.invoke(IPC.closeRoom),
    get: () => ipcRenderer.invoke(IPC.getHosted),
    onChanged: (cb) => subscribe<HostedRoom | null>(IPC.hostedChanged, cb)
  },
  capture: {
    listSources: () => ipcRenderer.invoke(IPC.listSources),
    select: (id, audio) => ipcRenderer.invoke(IPC.selectSource, id, audio),
    audioSupported: () => ipcRenderer.invoke(IPC.audioSupported),
    nativeAudio: {
      available: () => ipcRenderer.invoke(IPC.nativeAudioAvailable),
      start: (options) => ipcRenderer.invoke(IPC.nativeAudioStart, options),
      stop: (id) => ipcRenderer.invoke(IPC.nativeAudioStop, id),
      onData: (cb) => {
        const listener = (_e: IpcRendererEvent, id: number, chunk: Uint8Array): void => cb(id, chunk)
        ipcRenderer.on(IPC.nativeAudioData, listener)
        return () => ipcRenderer.removeListener(IPC.nativeAudioData, listener)
      },
      onEnded: (cb) => {
        const listener = (_e: IpcRendererEvent, id: number, reason: string): void => cb(id, reason)
        ipcRenderer.on(IPC.nativeAudioEnded, listener)
        return () => ipcRenderer.removeListener(IPC.nativeAudioEnded, listener)
      }
    },
    permission: () => ipcRenderer.invoke(IPC.screenPermission),
    openPermissionSettings: () => ipcRenderer.invoke(IPC.openPermissionSettings)
  },
  system: {
    stats: () => ipcRenderer.invoke(IPC.systemStats),
    info: () => ipcRenderer.invoke(IPC.appInfo),
    copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
    openLogs: () => ipcRenderer.invoke(IPC.openLogs),
    setViewerProtection: (enabled) => ipcRenderer.invoke(IPC.setViewerProtection, enabled),
    onWindowState: (cb) => subscribe<WindowState>(IPC.windowState, cb),
    log: (level, message) => ipcRenderer.send(IPC.log, level, message)
  }
}

contextBridge.exposeInMainWorld('api', api)
