import { useState } from 'react'
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../../shared/constants'
import type { HostedRoom, HostStats, Privacy } from '../../shared/types'
import { errorMessage, formatBitrate, latencyClass } from '../lib/format'
import { Icon } from './Icon'

/** Privacy, PIN and "how to reach me" panel for the host. */
export function AccessPanel({ hosted, onToast }: { hosted: HostedRoom; onToast(msg: string, tone?: 'error' | 'info'): void }) {
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

  const copy = (text: string, what: string): void => {
    void window.api.system.copyText(text).then(() => onToast(`${what} copied to clipboard`))
  }

  const setPrivacy = (p: Privacy): void => {
    if (p !== privacy) void update({ privacy: p })
  }

  const address = hosted.addresses[0] ? `${hosted.addresses[0]}:${hosted.port}` : `port ${hosted.port}`

  return (
    <div className="access-panel">
      <div className="panel-header">
        <h3>
          <Icon name="key" size={14} /> Access
        </h3>
      </div>
      <div className="segmented full">
        <button className={privacy === 'public' ? 'active' : ''} onClick={() => setPrivacy('public')}>
          <Icon name="globe" size={13} /> Public
        </button>
        <button className={privacy === 'private' ? 'active' : ''} onClick={() => setPrivacy('private')}>
          <Icon name="lock" size={13} /> Private
        </button>
      </div>

      {privacy === 'private' && hosted.pin && (
        <div className="pin-box">
          <span className="muted small">PIN</span>
          <button className="pin-value mono" title="Click to hide/show" onClick={() => setShowPin((v) => !v)}>
            {showPin ? hosted.pin : '•'.repeat(hosted.pin.length)}
          </button>
          <div className="pin-actions">
            <button className="icon-btn" title="Copy PIN" onClick={() => copy(hosted.pin!, 'PIN')}>
              <Icon name="copy" size={14} />
            </button>
            <button className="icon-btn" title="Generate a new PIN" onClick={() => void update({ pin: 'regenerate' })}>
              <Icon name="refresh" size={14} />
            </button>
            <button className="icon-btn" title="Set a custom PIN" onClick={() => setEditing((v) => !v)}>
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
            placeholder={`${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits`}
            value={customPin}
            onChange={(e) => setCustomPin(e.target.value.replace(/\D/g, ''))}
          />
          <button className="btn small primary" disabled={customPin.length < PIN_MIN_LENGTH}>
            Set
          </button>
        </form>
      )}
      <p className="muted small">
        {privacy === 'private'
          ? 'New viewers need this PIN. People already in the room stay connected when it changes.'
          : 'Anyone on your network can join.'}
      </p>
      <div className="address-row">
        <span className="muted small">VPN / manual address</span>
        <button
          className="link mono small"
          title={`Copy address\nAll addresses:\n${hosted.addresses.map((a) => `${a}:${hosted.port}`).join('\n')}`}
          onClick={() => copy(address, 'Address')}
        >
          {address} <Icon name="copy" size={12} />
        </button>
      </div>
    </div>
  )
}

/** Live encoder / network stats for the host. */
export function HostStatsPanel({ stats }: { stats: HostStats | null }) {
  if (!stats) return null
  const rows: [string, string, string?][] = [
    ['Resolution', stats.width && stats.height ? `${stats.width}×${stats.height}` : '–'],
    ['Frame rate', `${Math.round(stats.fps)} fps`],
    ['Upload', formatBitrate(stats.bitrateKbps)],
    ['Avg. RTT', stats.avgRttMs === null ? '–' : `${stats.avgRttMs} ms`, latencyClass(stats.avgRttMs === null ? null : stats.avgRttMs)],
    ['Encode', stats.encodeMs === null ? '–' : `${stats.encodeMs} ms`],
    ['Codec', stats.codec || '–'],
    ['Encoder', stats.encoder || '–'],
    ['CPU (app)', `${stats.cpuPercent.toFixed(1)} %`, stats.cpuPercent < 20 ? 'good' : stats.cpuPercent < 35 ? 'ok' : 'bad'],
    ['Memory', `${stats.memoryMB} MB`],
    ['Limited by', stats.qualityLimitation === 'none' ? 'nothing' : stats.qualityLimitation, stats.qualityLimitation === 'none' ? 'good' : 'ok']
  ]
  return (
    <div className="stats-panel">
      <div className="panel-header">
        <h3>
          <Icon name="chart" size={14} /> Stream stats
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
