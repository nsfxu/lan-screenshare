import type { Participant, ViewerStats } from '../../shared/types'
import { initials, latencyClass } from '../lib/format'
import { Icon } from './Icon'

interface Props {
  participants: Participant[]
  selfId: string
  isHost: boolean
  viewerStats: Map<string, ViewerStats>
  onKick(id: string): void
}

function statusOf(p: Participant): { label: string; tone: 'good' | 'warn' | 'bad' | 'idle' } {
  if (p.status === 'reconnecting') return { label: 'Reconnecting', tone: 'warn' }
  if (p.role === 'host') return { label: 'Host', tone: 'good' }
  switch (p.mediaState) {
    case 'streaming':
      return { label: p.transport === 'tcp' ? 'Watching (TCP)' : 'Watching', tone: 'good' }
    case 'negotiating':
      return { label: 'Connecting', tone: 'warn' }
    case 'failed':
      return { label: 'Stream failed', tone: 'bad' }
    default:
      return { label: 'Connected', tone: 'idle' }
  }
}

export function ViewerList({ participants, selfId, isHost, viewerStats, onKick }: Props) {
  const sorted = [...participants].sort(
    (a, b) => Number(b.role === 'host') - Number(a.role === 'host') || a.joinedAt - b.joinedAt
  )
  const viewers = participants.filter((p) => p.role === 'viewer').length
  return (
    <div className="viewer-list">
      <div className="panel-header">
        <h3>
          <Icon name="users" size={14} /> People <span className="count">{participants.length}</span>
        </h3>
        <span className="muted small">
          {viewers} viewer{viewers === 1 ? '' : 's'}
        </span>
      </div>
      <ul>
        {sorted.map((p) => {
          const status = statusOf(p)
          const stats = viewerStats.get(p.id)
          return (
            <li key={p.id}>
              <span className="avatar" style={{ background: p.color }}>
                {initials(p.name)}
                <span className={`presence ${status.tone}`} />
              </span>
              <div className="viewer-info">
                <span className="viewer-name">
                  {p.name}
                  {p.id === selfId && <span className="muted"> (you)</span>}
                </span>
                <span className="muted small">
                  {status.label}
                  {isHost && stats && p.mediaState === 'streaming' && (
                    <>
                      {' · '}
                      {stats.fps} fps ·{' '}
                      <span className={`lat ${latencyClass(stats.latencyMs)}`}>
                        {stats.latencyMs === null ? '–' : `${stats.latencyMs} ms`}
                      </span>
                      {stats.packetLossPct >= 1 ? ` · ${stats.packetLossPct.toFixed(1)}% loss` : ''}
                    </>
                  )}
                </span>
              </div>
              {isHost && p.role === 'viewer' && (
                <button className="icon-btn danger" title={`Remove ${p.name}`} onClick={() => onKick(p.id)}>
                  <Icon name="kick" size={15} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
