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
/** The themes used when following the computer, until others are picked. */
export const DEFAULT_DARK_THEME: ThemeId = 'classic'
export const DEFAULT_LIGHT_THEME: ThemeId = 'light'

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value)
}

export function themeKind(id: ThemeId): Theme['kind'] {
  return THEMES.find((t) => t.id === id)?.kind ?? 'dark'
}

export function isThemeOfKind(value: unknown, kind: Theme['kind']): value is ThemeId {
  return isThemeId(value) && themeKind(value) === kind
}

/** The theme settings: one theme, or one dark and one light that follow the computer's mode. */
export interface ThemeSettings {
  theme: ThemeId
  followSystemTheme: boolean
  darkTheme: ThemeId
  lightTheme: ThemeId
}

/** The theme to show now, given whether the computer is in dark mode. */
export function resolveTheme(s: ThemeSettings, systemDark: boolean): ThemeId {
  if (!s.followSystemTheme) return s.theme
  return systemDark ? s.darkTheme : s.lightTheme
}

/** What picking `id` in Settings changes: the one theme, or the dark or light one while following the computer. */
export function pickTheme(s: ThemeSettings, id: ThemeId): Partial<ThemeSettings> {
  if (!s.followSystemTheme) return { theme: id }
  return themeKind(id) === 'dark' ? { darkTheme: id } : { lightTheme: id }
}

/**
 * Turning "follow the computer" on or off without a jump: on, the theme in use becomes the dark
 * or light one (by its kind); off, the theme shown now stays as the one theme.
 */
export function followSystem(s: ThemeSettings, on: boolean, systemDark: boolean): Partial<ThemeSettings> {
  if (!on) return { followSystemTheme: false, theme: resolveTheme(s, systemDark) }
  return { followSystemTheme: true, ...(themeKind(s.theme) === 'dark' ? { darkTheme: s.theme } : { lightTheme: s.theme }) }
}
