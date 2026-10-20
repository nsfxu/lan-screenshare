import { useSyncExternalStore } from 'react'
import { lastShareOf, parseLastShare, type LastShare } from '../../shared/lastShare'
import type { AudioChoice, CaptureSource } from '../../shared/types'

/**
 * The last screen or window we shared, and its sound options, for "Share
 * again". Kept in this computer's localStorage, like the per-stream volume.
 */

const KEY = 'screenshare.lastShare'

/** Sources from the latest lists (the picker's, Share again's), so a share is remembered without listing again. */
const known = new Map<string, CaptureSource>()
const listeners = new Set<() => void>()
let current: LastShare | null = load()

function load(): LastShare | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? parseLastShare(JSON.parse(raw)) : null
  } catch {
    return null // storage unavailable, or not JSON
  }
}

export function getLastShare(): LastShare | null {
  return current
}

export function useLastShare(): LastShare | null {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, getLastShare)
}

/** A fresh source list: what a share started from it will be remembered as. */
export function noteSources(sources: readonly CaptureSource[]): void {
  known.clear()
  for (const s of sources) known.set(s.id, s)
}

/** A share started: remember it (listing the sources only if this one wasn't in the latest list). */
export async function rememberShare(sourceId: string, audio: AudioChoice): Promise<void> {
  let source = known.get(sourceId)
  if (!source) {
    noteSources(await window.api.capture.listSources())
    source = known.get(sourceId)
  }
  if (!source) return
  current = lastShareOf(source, audio)
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // storage unavailable: still offered until the app restarts
  }
  listeners.forEach((l) => l())
}
