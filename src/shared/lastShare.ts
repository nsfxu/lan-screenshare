import type { AudioChoice, CaptureSource } from './types'

/**
 * What was shared last, for "Share again": enough to find the same screen or
 * window in a new source list, and the sound options it was shared with.
 */
export interface LastShare {
  source: {
    id: string
    name: string
    kind: 'screen' | 'window'
    displayId: string
  }
  audio: AudioChoice
}

/** Window titles can be long; this is plenty to find the same window again. */
const MAX_NAME = 300

export function lastShareOf(source: CaptureSource, audio: AudioChoice): LastShare {
  return {
    source: { id: source.id, name: source.name.slice(0, MAX_NAME), kind: source.kind, displayId: source.displayId },
    audio: { enabled: audio.enabled, excludeDiscord: audio.excludeDiscord, appOnly: audio.appOnly }
  }
}

/** Reads a saved LastShare back (it comes from storage: anything may be there). */
export function parseLastShare(raw: unknown): LastShare | null {
  if (!raw || typeof raw !== 'object') return null
  const { source, audio } = raw as Record<string, unknown>
  if (!source || typeof source !== 'object' || !audio || typeof audio !== 'object') return null
  const s = source as Record<string, unknown>
  const a = audio as Record<string, unknown>
  if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.displayId !== 'string') return null
  if (s.kind !== 'screen' && s.kind !== 'window') return null
  if (typeof a.enabled !== 'boolean' || typeof a.excludeDiscord !== 'boolean' || typeof a.appOnly !== 'boolean') return null
  return {
    source: { id: s.id, name: s.name.slice(0, MAX_NAME), kind: s.kind, displayId: s.displayId },
    audio: { enabled: a.enabled, excludeDiscord: a.excludeDiscord, appOnly: a.appOnly }
  }
}

/**
 * The remembered source in today's list. A window keeps its id only while it
 * stays open (the app's next run gets a new one), so windows are also found
 * by their title; a screen by its display. Null when it's gone, or when the
 * title now matches several windows and we can't tell which.
 */
export function findLastSource(last: LastShare, sources: readonly CaptureSource[]): CaptureSource | null {
  const same = sources.find((s) => s.id === last.source.id && s.kind === last.source.kind)
  if (same) return same
  const ofKind = sources.filter((s) => s.kind === last.source.kind)
  if (last.source.kind === 'screen' && last.source.displayId) {
    const onDisplay = ofKind.filter((s) => s.displayId === last.source.displayId)
    if (onDisplay.length === 1) return onDisplay[0]
  }
  const named = ofKind.filter((s) => s.name === last.source.name)
  return named.length === 1 ? named[0] : null
}
