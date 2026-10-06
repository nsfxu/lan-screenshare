import { isThemeId, type ThemeId } from '../../shared/themes'

const KEY = 'screenshare.theme'

/** Colours the app with `theme`, and remembers it so the next start doesn't flash the default first. */
export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // only the first frame of the next start is affected
  }
}

/** Before the settings arrive: the theme used last time on this computer. */
export function applyRememberedTheme(): void {
  try {
    const theme = localStorage.getItem(KEY)
    if (isThemeId(theme)) document.documentElement.dataset.theme = theme
  } catch {
    // storage unavailable: the default theme until the settings load
  }
}
