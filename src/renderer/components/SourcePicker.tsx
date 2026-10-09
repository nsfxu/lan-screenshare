import { useEffect, useState } from 'react'
import type { CaptureSource, ScreenPermission } from '../../shared/types'
import { errorMessage } from '../lib/format'
import { useT } from '../lib/i18n'
import { Icon } from './Icon'

interface Props {
  selected: string | null
  onSelect(id: string): void
}

/** Grid of screens and windows with live thumbnails. */
export function SourcePicker({ selected, onSelect }: Props) {
  const { t } = useT()
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const [permission, setPermission] = useState<ScreenPermission>('granted')
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'screen' | 'window'>('screen')
  const [cursorCaveat, setCursorCaveat] = useState(false)

  const load = async (): Promise<void> => {
    setError(null)
    try {
      const [list, perm] = await Promise.all([window.api.capture.listSources(), window.api.capture.permission()])
      setSources(list)
      setPermission(perm)
      if (!selected) {
        const first = list.find((s) => s.kind === 'screen') ?? list[0]
        if (first) onSelect(first.id)
      }
    } catch (err) {
      setError(errorMessage(err))
      setSources([])
    }
  }

  useEffect(() => {
    void window.api.capture.hiddenCursor.affected().then(setCursorCaveat)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = (sources ?? []).filter((s) => s.kind === tab)

  return (
    <div className="source-picker">
      <div className="source-tabs">
        <div className="segmented">
          <button className={tab === 'screen' ? 'active' : ''} onClick={() => setTab('screen')} type="button">
            {t('source.screens')}
          </button>
          <button className={tab === 'window' ? 'active' : ''} onClick={() => setTab('window')} type="button">
            {t('source.windows')}
          </button>
        </div>
        <button className="icon-btn" type="button" title={t('source.reload')} onClick={() => void load()}>
          <Icon name="refresh" />
        </button>
      </div>

      {permission === 'denied' || permission === 'restricted' ? (
        <div className="notice warn">
          {t('source.permission')}
          <button className="btn small" type="button" onClick={() => void window.api.capture.openPermissionSettings()}>
            {t('source.openSettings')}
          </button>
        </div>
      ) : null}
      {error && <div className="notice error">{error}</div>}
      {cursorCaveat && tab === 'screen' && (
        <p className="muted small source-hint">{t('source.cursorCaveat')}</p>
      )}

      {sources === null ? (
        <div className="source-grid loading">{t('source.loading')}</div>
      ) : visible.length === 0 ? (
        <div className="source-grid empty-small muted">
          {tab === 'screen' ? t('source.noScreens') : t('source.noWindows')}
        </div>
      ) : (
        <div className="source-grid">
          {visible.map((s) => (
            <button
              type="button"
              key={s.id}
              className={`source ${selected === s.id ? 'selected' : ''}`}
              onClick={() => onSelect(s.id)}
              title={s.name}
            >
              <div className="thumb">
                {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <Icon name="screen" size={32} />}
              </div>
              <span className="source-name">{s.name}</span>
              {s.width && s.height ? (
                <span className="muted small">
                  {s.width}×{s.height}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
