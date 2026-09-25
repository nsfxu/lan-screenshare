import type { Participant } from '../../shared/types'
import { initials, latencyClass } from '../lib/format'
import type { WatcherInfo } from '../lib/publisher'
import { Icon } from './Icon'

interface Props {
  participants: Participant[]
  selfId: string
  isHost: boolean
  /** People watching *my* stream, with what they report about it. */
  myWatchers: ReadonlyMap<string, WatcherInfo>
  /** Streams I am watching. */
  watching: ReadonlySet<string>
  onWatch(id: string): void
  onUnwatch(id: string): void
  onKick(id: string): void
  onStopStream(id: string): void
}

function describe(p: Participant, all: Participant[]): { label: string; tone: 'good' | 'warn' | 'idle' } {
  if (p.status === 'reconnecting') return { label: 'Reconnecting', tone: 'warn' }
  if (p.stream) {
    const viewers = all.filter((x) => x.watching.includes(p.id)).length
    const state = p.stream.paused ? 'Sharing (paused)' : 'Sharing'
    return { label: `${state} · ${viewers} watching`, tone: 'good' }
  }
  if (p.watching.length > 0) {
    const names = p.watching.map((id) => all.find((x) => x.id === id)?.name ?? '?')
    return { label: `Watching ${names.join(', ')}`, tone: 'idle' }
  }
  return { label: 'Connected', tone: 'idle' }
}

export function ViewerList({ participants, selfId, isHost, myWatchers, watching, onWatch, onUnwatch, onKick, onStopStream }: Props) {
  const sorted = [...participants].sort(
    (a, b) =>
      Number(!!b.stream) - Number(!!a.stream) ||
      Number(b.role === 'host') - Number(a.role === 'host') ||
      a.joinedAt - b.joinedAt
  )
  const live = participants.filter((p) => p.stream).length
  return (
    <div className="viewer-list">
      <div className="panel-header">
        <h3>
          <Icon name="users" size={14} /> People <span className="count">{participants.length}</span>
        </h3>
        <span className="muted small">
          {live} sharing
        </span>
      </div>
      <ul>
        {sorted.map((p) => {
          const status = describe(p, participants)
          const mine = myWatchers.get(p.id)
          const isSelf = p.id === selfId
          return (
            <li key={p.id}>
              <span className="avatar" style={{ background: p.color }}>
                {initials(p.name)}
                <span className={`presence ${p.stream ? 'good' : status.tone}`} />
              </span>
              <div className="viewer-info">
                <span className="viewer-name">
                  {p.name}
                  {isSelf && <span className="muted"> (you)</span>}
                  {p.role === 'host' && <span className="role-tag">host</span>}
                  {p.stream?.audio && <Icon name="volume" size={12} className="inline-icon" />}
                </span>
                <span className="muted small">
                  {status.label}
                  {mine?.stats && mine.mediaState === 'streaming' && (
                    <>
                      {' · watching you: '}
                      {mine.stats.fps} fps ·{' '}
                      <span className={`lat ${latencyClass(mine.stats.latencyMs)}`}>
                        {mine.stats.latencyMs === null ? '–' : `${mine.stats.latencyMs} ms`}
                      </span>
                      {mine.stats.transport === 'tcp' ? ' · TCP' : ''}
                      {mine.stats.packetLossPct >= 1 ? ` · ${mine.stats.packetLossPct.toFixed(1)}% loss` : ''}
                    </>
                  )}
                </span>
              </div>
              {p.stream && !isSelf && (
                watching.has(p.id) ? (
                  <button className="btn small ghost" title={`Stop watching ${p.name}`} onClick={() => onUnwatch(p.id)}>
                    Stop
                  </button>
                ) : (
                  <button className="btn small primary" title={`Watch ${p.name}'s stream`} onClick={() => onWatch(p.id)}>
                    Watch
                  </button>
                )
              )}
              {isHost && p.stream && !isSelf && (
                <button className="icon-btn danger" title={`Stop ${p.name}'s stream`} onClick={() => onStopStream(p.id)}>
                  <Icon name="stop" size={15} />
                </button>
              )}
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
