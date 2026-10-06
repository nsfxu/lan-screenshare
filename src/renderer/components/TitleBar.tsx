import { usePlatform } from '../lib/appVersion'
import { Icon } from './Icon'

/**
 * The window's title bar, drawn by the app so it follows the theme. It drags
 * the window; the system's own buttons sit over its right end (Windows,
 * Linux) or its left end (macOS), so it leaves room for them.
 */
export function TitleBar() {
  const platform = usePlatform()
  return (
    <header className={`title-bar ${platform === 'darwin' ? 'mac' : ''}`}>
      <span className="title-bar-mark" aria-hidden="true">
        <Icon name="screen" size={12} />
      </span>
      <span className="title-bar-name">ScreenShare</span>
    </header>
  )
}
