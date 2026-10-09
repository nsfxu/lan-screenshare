import { useT } from '../lib/i18n'
import { Icon } from './Icon'

/** The centre while you're not in a room. */
export function Welcome({ hasRooms, onCreate }: { hasRooms: boolean; onCreate(): void }) {
  const { t } = useT()
  return (
    <div className="welcome">
      <div className="welcome-mark">
        <Icon name="screen" size={28} />
      </div>
      <h1>ScreenShare</h1>
      <p className="muted">
        {hasRooms ? t('welcome.pickRoom') : t('welcome.noRooms')}
      </p>
      <button className="btn primary" onClick={onCreate}>
        <Icon name="plus" /> {t('common.createRoom')}
      </button>
    </div>
  )
}
