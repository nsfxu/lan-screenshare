import { usePlatform } from '../lib/appVersion'
import { useT } from '../lib/i18n'
import { useUpdateStatus } from '../lib/update'
import { Icon } from './Icon'

/**
 * The window's title bar, drawn by the app so it follows the theme. It drags
 * the window; the system's own buttons sit over its right end (Windows,
 * Linux) or its left end (macOS), so it leaves room for them.
 */
export function TitleBar({ roomName, onRestartToUpdate }: { roomName: string | null; onRestartToUpdate(): void }) {
  const platform = usePlatform()
  const update = useUpdateStatus()
  const { t } = useT()
  return (
    <header className={`title-bar ${platform === 'darwin' ? 'mac' : ''}`}>
      <span className="title-bar-mark" aria-hidden="true">
        <Icon name="screen" size={12} />
      </span>
      <span className="title-bar-name">ScreenShare</span>
      {roomName && (
        <span className="title-bar-room" title={roomName}>
          · {roomName}
        </span>
      )}
      {update?.state === 'ready' && (
        <button className="title-bar-update" title={t('update.downloadedTip', { version: update.version })} onClick={onRestartToUpdate}>
          <Icon name="refresh" size={12} /> {t('update.restartToUpdate')}
        </button>
      )}
      {update?.state === 'available' && (
        <button
          className="title-bar-update"
          title={t('update.openPageTip')}
          onClick={() => void window.api.update.openPage()}
        >
          <Icon name="download" size={12} /> {t('update.updateTo', { version: update.version })}
        </button>
      )}
    </header>
  )
}
