import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_PORT, NAME_MAX_LENGTH } from '../shared/constants'
import { isLanguageSetting } from '../shared/i18n'
import { isAvatar } from '../shared/images'
import { qualityPresets } from '../shared/quality'
import { RECENT_ROOMS_MAX } from '../shared/roomList'
import { DEFAULT_THEME, isThemeId } from '../shared/themes'
import type { RoomEndpoint, Settings } from '../shared/types'
import { randomId } from '../utils/crypto'

/** Format version of settings.json written by this app; see migrate(). */
export const SETTINGS_VERSION = 3

/** Upgrades settings written by an older version of the app. */
export function migrate(raw: Partial<Settings>): Partial<Settings> {
  const version = typeof raw.settingsVersion === 'number' ? raw.settingsVersion : 1
  const out = { ...raw }
  // 2 (1.2.0): "Optimize for" got Automatic as its default. "motion" was the
  // old default, saved whether or not anyone chose it.
  if (version < 2 && out.contentHint === 'motion') out.contentHint = 'auto'
  // 3 (1.3.0): the room list remembers recent rooms; start with the last one.
  if (version < 3 && !out.recentRooms && out.lastRoom) out.recentRooms = [out.lastRoom]
  return out
}

function defaults(): Settings {
  let user = 'User'
  try {
    user = os.userInfo().username || user
  } catch {
    // some sandboxes forbid userInfo()
  }
  return {
    clientId: randomId() + randomId(),
    displayName: user.slice(0, NAME_MAX_LENGTH),
    maxQuality: '1080p60',
    adaptiveQuality: true,
    codec: 'auto',
    contentHint: 'auto',
    forceTcp: false,
    useTls: true,
    preferredPort: DEFAULT_PORT,
    autoRejoin: false,
    lastRoom: null,
    recentRooms: [],
    manualServers: [],
    notifications: true,
    pauseOnMinimize: false,
    showStatsOverlay: true,
    shareAudio: true,
    excludeDiscordAudio: true,
    appAudioOnly: true,
    settingsVersion: SETTINGS_VERSION,
    uploadBudgetMbps: 100,
    avatar: null,
    theme: DEFAULT_THEME,
    autoUpdate: true,
    language: 'system'
  }
}

export interface SettingsOptions {
  /** Accept the experimental 1080p @ 120 fps maximum quality (`--perf-high-fps`). */
  highFps: boolean
}

/** Settings persisted as JSON in the user-data directory. */
export class SettingsStore {
  private data: Settings
  private readonly file: string

  constructor(
    dir: string,
    private readonly options: SettingsOptions = { highFps: false }
  ) {
    this.file = path.join(dir, 'settings.json')
    const base = defaults()
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Settings>
      this.data = sanitize({ ...base, ...migrate(raw) }, base, this.options)
      if (raw.settingsVersion !== SETTINGS_VERSION) this.save()
    } catch {
      this.data = base
      this.save()
    }
  }

  get(): Settings {
    return structuredClone(this.data)
  }

  update(patch: Partial<Settings>): Settings {
    const next = sanitize({ ...this.data, ...patch }, this.data, this.options)
    // The client id identifies this install to rooms; it is never changed by the UI.
    next.clientId = this.data.clientId
    this.data = next
    this.save()
    return this.get()
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    } catch {
      // settings are a convenience; failure to persist is not fatal
    }
  }
}

function sanitize(s: Settings, fallback: Settings, options: SettingsOptions): Settings {
  const out = { ...s }
  out.displayName = String(s.displayName ?? '').trim().slice(0, NAME_MAX_LENGTH) || fallback.displayName
  if (!qualityPresets(options.highFps).some((p) => p.id === s.maxQuality)) out.maxQuality = fallback.maxQuality
  if (!['auto', 'h264', 'h265', 'vp9', 'av1'].includes(s.codec)) out.codec = fallback.codec
  if (!['auto', 'motion', 'detail'].includes(s.contentHint)) out.contentHint = fallback.contentHint
  out.settingsVersion = SETTINGS_VERSION
  const port = Number(s.preferredPort)
  out.preferredPort = Number.isInteger(port) && port >= 0 && port <= 65535 ? port : fallback.preferredPort
  out.manualServers = Array.isArray(s.manualServers) ? s.manualServers.filter(isEndpoint).slice(0, 50) : []
  out.lastRoom = isEndpoint(s.lastRoom) ? s.lastRoom : null
  out.recentRooms = Array.isArray(s.recentRooms) ? s.recentRooms.filter(isEndpoint).slice(0, RECENT_ROOMS_MAX) : []
  const budget = Number(s.uploadBudgetMbps)
  out.uploadBudgetMbps = Number.isInteger(budget) && budget >= 0 && budget <= 10_000 ? budget : fallback.uploadBudgetMbps
  out.avatar = s.avatar === null || isAvatar(s.avatar) ? s.avatar : fallback.avatar
  out.theme = isThemeId(s.theme) ? s.theme : fallback.theme
  out.language = isLanguageSetting(s.language) ? s.language : fallback.language
  for (const key of ['adaptiveQuality', 'forceTcp', 'useTls', 'autoRejoin', 'notifications', 'pauseOnMinimize', 'showStatsOverlay', 'shareAudio', 'excludeDiscordAudio', 'appAudioOnly', 'autoUpdate'] as const) {
    out[key] = typeof s[key] === 'boolean' ? s[key] : fallback[key]
  }
  return out
}

function isEndpoint(e: unknown): e is RoomEndpoint {
  const ep = e as RoomEndpoint
  return !!ep && typeof ep.address === 'string' && Number.isInteger(ep.port) && typeof ep.tls === 'boolean'
}
