/** The app's colour themes; the colours themselves are in src/renderer/styles.css (:root[data-theme]), their names in src/shared/i18n (theme.<id>). */
export type ThemeId = 'classic' | 'graphite' | 'midnight' | 'charcoal'

export interface Theme {
  id: ThemeId
  /** For the preview in Settings: background, panel, accent and live. */
  swatches: [string, string, string, string]
}

export const THEMES: readonly Theme[] = [
  {
    id: 'classic',
    swatches: ['#0f1115', '#161920', '#4f8cff', '#ff5d5d']
  },
  {
    id: 'graphite',
    swatches: ['#111214', '#1a1b1e', '#6d74ff', '#f2545b']
  },
  {
    id: 'midnight',
    swatches: ['#0b1220', '#111a2b', '#2dd4bf', '#ff5470']
  },
  {
    id: 'charcoal',
    swatches: ['#121016', '#1a1720', '#9b6dff', '#ff5a6e']
  }
]

export const DEFAULT_THEME: ThemeId = 'classic'

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value)
}
