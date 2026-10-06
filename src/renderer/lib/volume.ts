import { useEffect, useState } from 'react'

/** A stream's sound: volume 0–1, and muted (the volume is kept, to come back to it). */
export interface Level {
  volume: number
  muted: boolean
}

const PREFIX = 'screenshare.volume'
const listeners = new Map<string, Set<(level: Level) => void>>()
const levels = new Map<string, Level>()

function storageKey(key: string): string {
  return `${PREFIX}:${key}`
}

/**
 * The volume for `key` (a streamer's name): what was set last time on this
 * computer, else the last volume used for anyone.
 */
export function getLevel(key: string): Level {
  const known = levels.get(key)
  if (known) return known
  for (const k of [storageKey(key), PREFIX]) {
    try {
      const saved = JSON.parse(localStorage.getItem(k) ?? 'null') as Level | null
      if (saved && typeof saved.volume === 'number') {
        const level = { volume: Math.min(1, Math.max(0, saved.volume)), muted: !!saved.muted }
        levels.set(key, level)
        return level
      }
    } catch {
      // storage unavailable
    }
  }
  return { volume: 1, muted: false }
}

export function setLevel(key: string, level: Level): void {
  levels.set(key, level)
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(level))
    // Also the starting volume for streams without their own setting.
    localStorage.setItem(PREFIX, JSON.stringify(level))
  } catch {
    // remembered for this session only
  }
  listeners.get(key)?.forEach((cb) => cb(level))
}

/** Set the volume; moving the slider also unmutes (or mutes at 0). */
export function setVolume(key: string, volume: number): void {
  const v = Math.min(1, Math.max(0, volume))
  setLevel(key, { volume: v, muted: v === 0 })
}

/** Mute, or unmute back to the last volume (full volume if that was 0). */
export function toggleMute(key: string): void {
  const level = getLevel(key)
  const muted = level.muted || level.volume === 0
  setLevel(key, muted ? { volume: level.volume || 1, muted: false } : { ...level, muted: true })
}

export function isSilent(level: Level): boolean {
  return level.muted || level.volume === 0
}

/** The volume for `key`, kept up to date wherever it changes (tile, menu, focus controls). */
export function useLevel(key: string): Level {
  const [level, setLocal] = useState(() => getLevel(key))
  useEffect(() => {
    setLocal(getLevel(key))
    const set = listeners.get(key) ?? new Set()
    listeners.set(key, set)
    set.add(setLocal)
    return () => {
      set.delete(setLocal)
    }
  }, [key])
  return level
}
