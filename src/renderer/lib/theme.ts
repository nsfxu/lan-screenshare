import { useEffect, useState } from 'react'
import { isThemeId, type ThemeId } from '../../shared/themes'

const KEY = 'screenshare.theme'

/** Colours the app with `theme`, and remembers it so the next start doesn't flash the default first. */
export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme
  // The system's window buttons over our title bar follow the theme too.
  const css = getComputedStyle(document.documentElement)
  void window.api.system.setTitleBarColors(css.getPropertyValue('--bg').trim(), css.getPropertyValue('--text').trim())
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

const DARK_MODE = '(prefers-color-scheme: dark)'

/** Whether the computer is in dark mode now, following it as it changes (e.g. at sunset). */
export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(DARK_MODE).matches)
  useEffect(() => {
    const query = window.matchMedia(DARK_MODE)
    const onChange = (): void => setDark(query.matches)
    query.addEventListener('change', onChange)
    onChange()
    return () => query.removeEventListener('change', onChange)
  }, [])
  return dark
}
