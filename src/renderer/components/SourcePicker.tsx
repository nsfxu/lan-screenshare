import { useEffect, useState } from 'react'
import type { CaptureSource, ScreenPermission } from '../../shared/types'
import { errorMessage } from '../lib/format'
import { Icon } from './Icon'

interface Props {
  selected: string | null
  onSelect(id: string): void
}

/** Grid of screens and windows with live thumbnails. */
export function SourcePicker({ selected, onSelect }: Props) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const [permission, setPermission] = useState<ScreenPermission>('granted')
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'screen' | 'window'>('screen')

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
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = (sources ?? []).filter((s) => s.kind === tab)

  return (
    <div className="source-picker">
      <div className="source-tabs">
        <div className="segmented">
          <button className={tab === 'screen' ? 'active' : ''} onClick={() => setTab('screen')} type="button">
            Screens
          </button>
          <button className={tab === 'window' ? 'active' : ''} onClick={() => setTab('window')} type="button">
            Windows
          </button>
        </div>
        <button className="icon-btn" type="button" title="Reload sources" onClick={() => void load()}>
          <Icon name="refresh" />
        </button>
      </div>

      {permission === 'denied' || permission === 'restricted' ? (
        <div className="notice warn">
          Screen Recording permission is required. Allow ScreenShare in System Settings → Privacy &amp; Security →
          Screen Recording, then restart the app.
          <button className="btn small" type="button" onClick={() => void window.api.capture.openPermissionSettings()}>
            Open settings
          </button>
        </div>
      ) : null}
      {error && <div className="notice error">{error}</div>}

      {sources === null ? (
        <div className="source-grid loading">Loading sources…</div>
      ) : visible.length === 0 ? (
        <div className="source-grid empty-small muted">No {tab === 'screen' ? 'screens' : 'windows'} available</div>
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
