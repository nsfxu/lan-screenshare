import type { AudioChoice } from '../../shared/types'
import { t, translator } from './i18n'

/** Strip Electron's "Error invoking remote method 'x': Error: " prefix. */
export function errorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

export function formatTime(ts: number): string {
  return translator().time(ts)
}

export function formatBitrate(kbps: number): string {
  if (kbps >= 1000) return t('common.mbps', { value: translator().number(kbps / 1000, 1) })
  return t('common.kbps', { value: Math.round(kbps) })
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return t('duration.seconds', { s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('duration.minutes', { m, s: s % 60 })
  return t('duration.hours', { h: Math.floor(m / 60), m: m % 60 })
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const chars = parts.length === 1 ? [...parts[0]].slice(0, 2) : [[...parts[0]][0], [...parts[parts.length - 1]][0]]
  return chars.join('').toUpperCase()
}

export function roomUrl(ep: { address: string; port: number; tls: boolean }): string {
  const host = ep.address.includes(':') ? `[${ep.address}]` : ep.address
  return `${ep.tls ? 'wss' : 'ws'}://${host}:${ep.port}/ws`
}

/** Explain why system audio could not be captured, with a fix when we know one. */
export function audioUnavailableMessage(error: string | null): string {
  if (error === 'NotReadableError' && /Windows/.test(navigator.userAgent)) {
    // Only reached when both Chromium's loopback and the native helper failed.
    return t('audio.surround')
  }
  if (error === 'NotReadableError' || error === 'NotAllowedError') return t('audio.unavailableMac')
  return t('audio.unavailable')
}

/** After starting a share: what to tell the user when the sound isn't what they chose, or null. */
export function captureAudioWarning(
  result: { hasAudio: boolean; audioError: string | null; appAudioFailed: boolean; discordExclusionFailed: boolean },
  asked: AudioChoice
): string | null {
  if (!asked.enabled) return null
  if (!result.hasAudio) return audioUnavailableMessage(result.audioError)
  // "Only this app's sound", or "Leave out Discord", was on but the whole system mix is being shared.
  if (result.appAudioFailed) return t('audio.appFailed')
  if (result.discordExclusionFailed) return t('audio.discordNotExcluded')
  return null
}

export function latencyClass(ms: number | null): 'good' | 'ok' | 'bad' | 'unknown' {
  if (ms === null) return 'unknown'
  if (ms < 100) return 'good'
  if (ms < 150) return 'ok'
  return 'bad'
}
