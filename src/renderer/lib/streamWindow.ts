import { STREAM_WINDOW_PREFIX } from '../../shared/constants'

/**
 * Opens (or brings forward) a stream's own window: a blank page in this same
 * renderer process, so the room can render the stream it already receives
 * into it with a React portal, with no second connection. The main process
 * allows only these windows (see setWindowOpenHandler in src/main/index.ts).
 *
 * Returns the element to render into, or null if the window couldn't open.
 */
export function openStreamWindow(id: string, title: string): { win: Window; root: HTMLElement } | null {
  const win = window.open('', `${STREAM_WINDOW_PREFIX}${id}`)
  if (!win) return null
  const doc = win.document
  const existing = doc.querySelector<HTMLElement>('.stream-window')
  if (existing) {
    win.focus()
    return { win, root: existing }
  }
  doc.title = title
  // The app's styles, copied as text: the page is about:blank, so links relative to the app wouldn't load.
  const css = [...document.styleSheets]
    .map((sheet) => {
      try {
        return [...sheet.cssRules].map((rule) => rule.cssText).join('\n')
      } catch {
        return '' // a sheet we may not read
      }
    })
    .join('\n')
  const style = doc.createElement('style')
  style.textContent = css
  doc.head.appendChild(style)
  // The app's theme, now and when it changes while the window is open.
  const syncTheme = (): void => {
    doc.documentElement.dataset.theme = document.documentElement.dataset.theme ?? ''
  }
  syncTheme()
  const themeWatch = new MutationObserver(syncTheme)
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  win.addEventListener('pagehide', () => themeWatch.disconnect())
  doc.body.classList.add('stream-window-body')
  const root = doc.createElement('div')
  root.className = 'stream-window'
  doc.body.appendChild(root)
  return { win, root }
}
