import { usePlatform } from '../lib/appVersion'
import { useUpdateStatus } from '../lib/update'
import { Icon } from './Icon'

/**
 * The window's title bar, drawn by the app so it follows the theme. It drags
 * the window; the system's own buttons sit over its right end (Windows,
 * Linux) or its left end (macOS), so it leaves room for them.
 */
export function TitleBar({ onRestartToUpdate }: { onRestartToUpdate(): void }) {
  const platform = usePlatform()
  const update = useUpdateStatus()
  return (
    <header className={`title-bar ${platform === 'darwin' ? 'mac' : ''}`}>
      <span className="title-bar-mark" aria-hidden="true">
        <Icon name="screen" size={12} />
      </span>
      <span className="title-bar-name">ScreenShare</span>
      {update?.state === 'ready' && (
        <button className="title-bar-update" title={`ScreenShare ${update.version} is downloaded`} onClick={onRestartToUpdate}>
          <Icon name="refresh" size={12} /> Restart to update
        </button>
      )}
      {update?.state === 'available' && (
        <button
          className="title-bar-update"
          title="Opens the download page"
          onClick={() => void window.api.update.openPage()}
        >
          <Icon name="download" size={12} /> Update to {update.version}
        </button>
      )}
    </header>
  )
}
