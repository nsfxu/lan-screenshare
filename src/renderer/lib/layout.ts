import { useCallback, useState } from 'react'

/**
 * A layout choice (a collapsed panel, a view mode) remembered on this
 * computer. Storage can be missing or blocked: then it's just not remembered.
 */
export function useRemembered<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(`layout.${key}`)
      return allowed.includes(stored as T) ? (stored as T) : fallback
    } catch {
      return fallback
    }
  })
  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(`layout.${key}`, v)
      } catch {
        // not remembered, still applied
      }
    },
    [key]
  )
  return [value, set]
}

export type PanelState = 'open' | 'closed'
export const PANEL_STATES: readonly PanelState[] = ['open', 'closed']
