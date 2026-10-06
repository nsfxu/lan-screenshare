/** The app's colour themes; the colours themselves are in src/renderer/styles.css (:root[data-theme]). */
export type ThemeId = 'classic' | 'graphite' | 'midnight' | 'charcoal'

export interface Theme {
  id: ThemeId
  label: string
  description: string
  /** For the preview in Settings: background, panel, accent and live. */
  swatches: [string, string, string, string]
}

export const THEMES: readonly Theme[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Blue on blue-grey, as before',
    swatches: ['#0f1115', '#161920', '#4f8cff', '#ff5d5d']
  },
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Neutral greys and indigo: streams look true to colour',
    swatches: ['#111214', '#1a1b1e', '#6d74ff', '#f2545b']
  },
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Deep blue-black and teal',
    swatches: ['#0b1220', '#111a2b', '#2dd4bf', '#ff5470']
  },
  {
    id: 'charcoal',
    label: 'Charcoal',
    description: 'Warm greys and violet',
    swatches: ['#121016', '#1a1720', '#9b6dff', '#ff5a6e']
  }
]

export const DEFAULT_THEME: ThemeId = 'classic'

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value)
}
