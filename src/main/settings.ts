import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_PORT, NAME_MAX_LENGTH } from '../shared/constants'
import { QUALITY_PRESETS } from '../shared/quality'
import type { RoomEndpoint, Settings } from '../shared/types'
import { randomId } from '../utils/crypto'

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
    contentHint: 'motion',
    forceTcp: false,
    useTls: true,
    preferredPort: DEFAULT_PORT,
    autoRejoin: false,
    lastRoom: null,
    manualServers: [],
    notifications: true,
    pauseOnMinimize: false,
    showStatsOverlay: true,
    shareAudio: true
  }
}

/** Settings persisted as JSON in the user-data directory. */
export class SettingsStore {
  private data: Settings
  private readonly file: string

  constructor(dir: string) {
    this.file = path.join(dir, 'settings.json')
    const base = defaults()
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Settings>
      this.data = sanitize({ ...base, ...raw }, base)
    } catch {
      this.data = base
      this.save()
    }
  }

  get(): Settings {
    return structuredClone(this.data)
  }

  update(patch: Partial<Settings>): Settings {
    const next = sanitize({ ...this.data, ...patch }, this.data)
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

function sanitize(s: Settings, fallback: Settings): Settings {
  const out = { ...s }
  out.displayName = String(s.displayName ?? '').trim().slice(0, NAME_MAX_LENGTH) || fallback.displayName
  if (!QUALITY_PRESETS.some((p) => p.id === s.maxQuality)) out.maxQuality = fallback.maxQuality
  if (!['auto', 'h264', 'h265', 'vp9', 'av1'].includes(s.codec)) out.codec = fallback.codec
  if (!['motion', 'detail'].includes(s.contentHint)) out.contentHint = fallback.contentHint
  const port = Number(s.preferredPort)
  out.preferredPort = Number.isInteger(port) && port >= 0 && port <= 65535 ? port : fallback.preferredPort
  out.manualServers = Array.isArray(s.manualServers) ? s.manualServers.filter(isEndpoint).slice(0, 50) : []
  out.lastRoom = isEndpoint(s.lastRoom) ? s.lastRoom : null
  for (const key of ['adaptiveQuality', 'forceTcp', 'useTls', 'autoRejoin', 'notifications', 'pauseOnMinimize', 'showStatsOverlay', 'shareAudio'] as const) {
    out[key] = typeof s[key] === 'boolean' ? s[key] : fallback[key]
  }
  return out
}

function isEndpoint(e: unknown): e is RoomEndpoint {
  const ep = e as RoomEndpoint
  return !!ep && typeof ep.address === 'string' && Number.isInteger(ep.port) && typeof ep.tls === 'boolean'
}
