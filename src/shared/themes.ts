/** The app's colour themes; the colours themselves are in src/renderer/styles.css (:root[data-theme]), their names in src/shared/i18n (theme.<id>). */
export type ThemeId =
  | 'classic'
  | 'graphite'
  | 'midnight'
  | 'charcoal'
  | 'black'
  | 'forest'
  | 'ember'
  | 'light'
  | 'paper'
  | 'mist'

export interface Theme {
  id: ThemeId
  /** Settings lists the dark themes, then the light ones. */
  kind: 'dark' | 'light'
  /** For the preview in Settings: background, panel, accent and live. */
  swatches: [string, string, string, string]
}

export const THEMES: readonly Theme[] = [
  { id: 'classic', kind: 'dark', swatches: ['#0f1115', '#161920', '#4f8cff', '#ff5d5d'] },
  { id: 'graphite', kind: 'dark', swatches: ['#111214', '#1a1b1e', '#6d74ff', '#f2545b'] },
  { id: 'midnight', kind: 'dark', swatches: ['#0b1220', '#111a2b', '#2dd4bf', '#ff5470'] },
  { id: 'charcoal', kind: 'dark', swatches: ['#121016', '#1a1720', '#9b6dff', '#ff5a6e'] },
  { id: 'black', kind: 'dark', swatches: ['#000000', '#0b0b0c', '#8ab4f8', '#f87171'] },
  { id: 'forest', kind: 'dark', swatches: ['#0d1410', '#131c17', '#34d399', '#ff6b6b'] },
  { id: 'ember', kind: 'dark', swatches: ['#15110e', '#1d1814', '#f59e0b', '#ff5d5d'] },
  { id: 'light', kind: 'light', swatches: ['#f5f6f8', '#ffffff', '#2563eb', '#dc2626'] },
  { id: 'paper', kind: 'light', swatches: ['#f6f1e9', '#fffaf3', '#c2410c', '#c0392b'] },
  { id: 'mist', kind: 'light', swatches: ['#eef2f5', '#f9fbfc', '#0f766e', '#d6334a'] }
]

export const DEFAULT_THEME: ThemeId = 'classic'

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value)
}
