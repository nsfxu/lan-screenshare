import { useState } from 'react'
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../../shared/constants'
import type { HostedRoom, HostStats, Privacy } from '../../shared/types'
import { errorMessage, formatBitrate, latencyClass } from '../lib/format'
import { useT } from '../lib/i18n'
import { Icon } from './Icon'

/** Privacy, PIN and "how to reach me" panel for the host. */
export function AccessPanel({ hosted, onToast }: { hosted: HostedRoom; onToast(msg: string, tone?: 'error' | 'info'): void }) {
  const { t } = useT()
  const [editing, setEditing] = useState(false)
  const [customPin, setCustomPin] = useState('')
  const [showPin, setShowPin] = useState(true)
  const privacy = hosted.info.privacy

  const update = async (req: Parameters<typeof window.api.host.update>[0]): Promise<void> => {
    try {
      await window.api.host.update(req)
    } catch (err) {
      onToast(errorMessage(err), 'error')
    }
  }

  const copy = (text: string, done: string): void => {
    void window.api.system.copyText(text).then(() => onToast(done))
  }

  const setPrivacy = (p: Privacy): void => {
    if (p !== privacy) void update({ privacy: p })
  }

  const address = hosted.addresses[0] ? `${hosted.addresses[0]}:${hosted.port}` : t('access.portOnly', { port: String(hosted.port) })

  return (
    <div className="access-panel">
      <div className="panel-header">
        <h3>
          <Icon name="key" size={14} /> {t('access.title')}
        </h3>
      </div>
      <div className="segmented full">
        <button className={privacy === 'public' ? 'active' : ''} onClick={() => setPrivacy('public')}>
          <Icon name="globe" size={13} /> {t('common.public')}
        </button>
        <button className={privacy === 'private' ? 'active' : ''} onClick={() => setPrivacy('private')}>
          <Icon name="lock" size={13} /> {t('common.private')}
        </button>
      </div>

      {privacy === 'private' && hosted.pin && (
        <div className="pin-box">
          <span className="muted small">{t('access.pin')}</span>
          <button className="pin-value mono" title={t('access.toggleShow')} onClick={() => setShowPin((v) => !v)}>
            {showPin ? hosted.pin : '•'.repeat(hosted.pin.length)}
          </button>
          <div className="pin-actions">
            <button className="icon-btn" title={t('access.copyPin')} onClick={() => copy(hosted.pin!, t('access.pinCopied'))}>
              <Icon name="copy" size={14} />
            </button>
            <button className="icon-btn" title={t('access.newPin')} onClick={() => void update({ pin: 'regenerate' })}>
              <Icon name="refresh" size={14} />
            </button>
            <button className="icon-btn" title={t('access.customPin')} onClick={() => setEditing((v) => !v)}>
              <Icon name="settings" size={14} />
            </button>
          </div>
        </div>
      )}
      {privacy === 'private' && editing && (
        <form
          className="pin-edit"
          onSubmit={(e) => {
            e.preventDefault()
            void update({ pin: customPin }).then(() => {
              setEditing(false)
              setCustomPin('')
            })
          }}
        >
          <input
            autoFocus
            inputMode="numeric"
            maxLength={PIN_MAX_LENGTH}
            placeholder={t('access.pinPlaceholder', { min: PIN_MIN_LENGTH, max: PIN_MAX_LENGTH })}
            value={customPin}
            onChange={(e) => setCustomPin(e.target.value.replace(/\D/g, ''))}
          />
          <button className="btn small primary" disabled={customPin.length < PIN_MIN_LENGTH}>
            {t('access.set')}
          </button>
        </form>
      )}
      <p className="muted small">
        {privacy === 'private' ? t('access.privateHint') : t('access.publicHint')}
      </p>
      <div className="address-row">
        <span className="muted small">{t('access.address')}</span>
        <button
          className="link mono small"
          title={t('access.addressTip', { list: hosted.addresses.map((a) => `${a}:${hosted.port}`).join('\n') })}
          onClick={() => copy(address, t('common.addressCopied'))}
        >
          {address} <Icon name="copy" size={12} />
        </button>
      </div>
    </div>
  )
}

function gigabytes(mb: number, number: (n: number, digits: number) => string): string {
  return number(Math.round((mb / 1024) * 10) / 10, 1)
}

/** Most of the memory in use is fine; nearly all of it means the computer is swapping. */
function memoryTone(used: number): string {
  return used < 0.8 ? 'good' : used < 0.92 ? 'ok' : 'bad'
}

/** Live encoder / network stats for the host. */
export function HostStatsPanel({ stats }: { stats: HostStats | null }) {
  const { t, number } = useT()
  if (!stats) return null
  const limits = { none: t('stats.limit.none'), cpu: t('stats.limit.cpu'), bandwidth: t('stats.limit.bandwidth'), other: t('stats.limit.other') }
  const limitedBy = limits[stats.qualityLimitation as keyof typeof limits] ?? stats.qualityLimitation
  const hint = stats.contentHint === 'motion' ? t('stats.smoothMotion') : t('stats.sharpText')
  const rows: [string, string, string?][] = [
    [t('stats.resolution'), stats.width && stats.height ? `${stats.width}×${stats.height}` : '–'],
    [t('stats.frameRate'), t('common.fps', { value: Math.round(stats.fps) })],
    [t('stats.upload'), formatBitrate(stats.bitrateKbps)],
    [
      t('stats.rtt'),
      stats.avgRttMs === null ? '–' : t('common.ms', { value: stats.avgRttMs }),
      latencyClass(stats.avgRttMs === null ? null : stats.avgRttMs)
    ],
    [t('stats.encode'), stats.encodeMs === null ? '–' : t('common.ms', { value: stats.encodeMs })],
    [t('stats.codec'), stats.codec || '–'],
    [t('stats.encoder'), stats.encoder || '–'],
    [
      t('stats.cpuApp'),
      `${number(stats.cpuPercent, 1)} %`,
      stats.cpuPercent < 20 ? 'good' : stats.cpuPercent < 35 ? 'ok' : 'bad'
    ],
    [t('stats.memoryApp'), `${stats.memoryMB} MB`],
    [
      t('stats.cpuComputer'),
      stats.computerCpuPercent === null ? '–' : `${Math.round(stats.computerCpuPercent)} %`,
      stats.computerCpuPercent === null ? undefined : stats.computerCpuPercent < 70 ? 'good' : stats.computerCpuPercent < 90 ? 'ok' : 'bad'
    ],
    [
      t('stats.memoryComputer'),
      stats.computerMemoryTotalMB
        ? t('stats.memoryOf', {
            used: gigabytes(stats.computerMemoryMB, number),
            total: gigabytes(stats.computerMemoryTotalMB, number)
          })
        : '–',
      stats.computerMemoryTotalMB
        ? memoryTone(stats.computerMemoryMB / stats.computerMemoryTotalMB)
        : undefined
    ],
    [t('stats.limitedBy'), limitedBy, stats.qualityLimitation === 'none' ? 'good' : 'ok'],
    [t('stats.optimizedFor'), stats.contentHintAuto ? t('stats.automatic', { hint }) : hint]
  ]
  return (
    <div className="stats-panel">
      <div className="panel-header">
        <h3>
          <Icon name="chart" size={14} /> {t('room.streamStats')}
        </h3>
      </div>
      <dl>
        {rows.map(([k, v, tone]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={tone ?? ''} title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
