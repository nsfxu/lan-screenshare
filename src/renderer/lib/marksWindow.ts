import { MARKS_WINDOW_NAME } from '../../shared/constants'

/**
 * Opens the streamer's marks window: a see-through, click-through window the
 * main process lays over the shared screen and keeps out of screen capture,
 * so marks don't come back, late, in the video (see setWindowOpenHandler in
 * src/main/index.ts). Like a stream's own window it's a blank page in this
 * renderer, which the room fills with a React portal.
 *
 * Returns the element to render into, or null if it couldn't open.
 */
export function openMarksWindow(): { win: Window; root: HTMLElement } | null {
  const win = window.open('', MARKS_WINDOW_NAME)
  if (!win) return null
  const doc = win.document
  const existing = doc.querySelector<HTMLElement>('.marks-window')
  if (existing) return { win, root: existing }
  doc.title = 'ScreenShare'
  // Nothing of its own may show: only the marks drawn into it.
  doc.documentElement.style.background = 'transparent'
  doc.body.style.cssText = 'margin:0;background:transparent;overflow:hidden'
  const root = doc.createElement('div')
  root.className = 'marks-window'
  root.style.cssText = 'position:fixed;inset:0'
  doc.body.appendChild(root)
  return { win, root }
}
