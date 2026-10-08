import { useState, type MouseEvent } from 'react'
import type { Participant } from '../../shared/types'
import { askConfirm } from '../lib/confirm'
import { latencyClass } from '../lib/format'
import type { WatcherInfo } from '../lib/publisher'
import { useRoomPeople } from '../lib/roomPeople'
import type { Session } from '../lib/session'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { Menu, type MenuAt, type MenuItem } from './Menu'

/** Where the stream preview goes: next to the row it belongs to. */
interface Anchor {
  id: string
  top: number
  left: number
}

/**
 * Everyone in the room you're in, listed under it in the rooms sidebar.
 * Clicking someone who is live starts or stops watching them; hovering shows
 * their stream's latest preview.
 */
export function RoomMembers({ session }: { session: Session }) {
  const { client, watches } = session
  const isHost = session.role === 'host'
  const { participants, avatars, snapshots, watching, myWatchers } = useRoomPeople(session)
  const [preview, setPreview] = useState<Anchor | null>(null)
  const [menu, setMenu] = useState<{ at: MenuAt; id: string } | null>(null)

  const sorted = [...participants].sort(
    (a, b) =>
      Number(!!b.stream) - Number(!!a.stream) ||
      Number(b.role === 'host') - Number(a.role === 'host') ||
      a.joinedAt - b.joinedAt
  )
  const byId = (id: string): Participant | undefined => participants.find((p) => p.id === id)
  const watcherCount = (id: string): number => participants.filter((p) => p.watching.includes(id)).length

  const anchorAt = (e: { currentTarget: HTMLElement }, id: string, height: number): Anchor => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { id, top: Math.max(8, Math.min(rect.top, window.innerHeight - height - 8)), left: rect.right + 8 }
  }

  const previewed = preview && byId(preview.id)
  const menuFor = menu && byId(menu.id)

  /** What you can do about someone: watch them, and for the host, moderate. */
  const itemsFor = (p: Participant): MenuItem[] => {
    const items: MenuItem[] = []
    if (p.stream && p.id !== client.selfId) {
      items.push(
        watching.has(p.id)
          ? { label: 'Stop watching', icon: 'x', onSelect: () => watches.unwatch(p.id) }
          : { label: 'Watch stream', icon: 'eye', onSelect: () => watches.watch(p.id) }
      )
    }
    if (isHost && p.id !== client.selfId) {
      if (items.length > 0) items.push({ kind: 'separator' })
      if (p.stream) {
        items.push({
          label: `Stop ${p.name}'s stream`,
          icon: 'stop',
          danger: true,
          onSelect: () =>
            void askConfirm({ title: `Stop ${p.name}'s stream?`, confirm: 'Stop stream', danger: true }).then(
              (ok) => ok && client.send({ type: 'stop-stream', userId: p.id })
            )
        })
      }
      if (p.role === 'viewer') {
        items.push({
          label: 'Remove from room',
          icon: 'kick',
          danger: true,
          onSelect: () =>
            void askConfirm({
              title: `Remove ${p.name} from the room?`,
              message: "They can't come back to this room.",
              confirm: 'Remove',
              danger: true
            }).then((ok) => ok && client.send({ type: 'kick', userId: p.id }))
        })
      }
    }
    return items
  }
  const rightClick = (p: Participant) => (e: MouseEvent): void => {
    e.preventDefault()
    if (itemsFor(p).length > 0) setMenu({ at: { x: e.clientX, y: e.clientY }, id: p.id })
  }

  return (
    <ul className="room-members" aria-label="People in this room">
      {sorted.map((p) => {
        const isSelf = p.id === client.selfId
        const watched = watching.has(p.id)
        const canWatch = !!p.stream && !isSelf
        const label = (
          <>
            <Avatar name={p.name} color={p.color} image={avatars.get(p.id)} size="small">
              {p.status === 'reconnecting' && <span className="presence warn" />}
            </Avatar>
            <span className="member-text">
              <span className="member-name">
                <span className="member-name-text">{p.name}</span>
                {isSelf && <span className="muted member-you">(you)</span>}
                {p.role === 'host' && <span className="role-tag">host</span>}
              </span>
              <MemberStatus participant={p} mine={myWatchers.get(p.id)} />
            </span>
            {p.stream && <span className={`live-badge ${p.stream.paused ? 'paused' : ''}`}>{p.stream.paused ? 'Paused' : 'Live'}</span>}
            {watched && <Icon name="eye" size={14} className="member-watching" />}
          </>
        )
        return (
          <li key={p.id} className={`member ${watched ? 'watching' : ''}`} onContextMenu={rightClick(p)}>
            {canWatch ? (
              <button
                className="member-main"
                aria-label={`${p.name}, live`}
                aria-pressed={watched}
                title={watched ? `Stop watching ${p.name}` : `Watch ${p.name}'s stream`}
                onClick={() => (watched ? watches.unwatch(p.id) : watches.watch(p.id))}
                // Over, not enter: the pointer can already be there when the row appears (just after joining).
                onMouseOver={(e) => preview?.id !== p.id && setPreview(anchorAt(e, p.id, 170))}
                onMouseLeave={() => setPreview(null)}
                onFocus={(e) => setPreview(anchorAt(e, p.id, 170))}
                onBlur={() => setPreview(null)}
              >
                {label}
              </button>
            ) : (
              <div className="member-main">{label}</div>
            )}
            {isHost && !isSelf && (
              <button
                className="icon-btn member-more"
                title={`Moderate ${p.name}`}
                aria-label={`Moderate ${p.name}`}
                aria-haspopup="menu"
                aria-expanded={menu?.id === p.id}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setMenu(menu?.id === p.id ? null : { at: { x: rect.right + 4, y: rect.top }, id: p.id })
                }}
              >
                <Icon name="more" size={16} />
              </button>
            )}
          </li>
        )
      })}

      {preview && previewed?.stream && (
        <div className="member-preview" style={{ top: preview.top, left: preview.left }} aria-hidden="true">
          <div className="member-preview-image">
            {snapshots.get(previewed.id) ? <img src={snapshots.get(previewed.id)} alt="" /> : <Icon name="screen" size={28} />}
            {previewed.stream.paused && <span className="preview-flag">Paused</span>}
          </div>
          <div className="member-preview-info">
            <strong>{previewed.name}</strong>
            <span className="muted small">
              {watcherCount(previewed.id) === 0 ? 'no one watching' : `${watcherCount(previewed.id)} watching`}
            </span>
          </div>
          <span className="muted small">{watching.has(previewed.id) ? 'Click to stop watching' : 'Click to watch'}</span>
        </div>
      )}

      {menu && menuFor && (
        <Menu items={itemsFor(menuFor)} at={menu.at} label={`${menuFor.name}`} onClose={() => setMenu(null)} />
      )}
    </ul>
  )
}

/** The small line under a name: only what's worth knowing at a glance. */
function MemberStatus({ participant: p, mine }: { participant: Participant; mine: WatcherInfo | undefined }) {
  if (p.status === 'reconnecting') return <span className="member-status warn">Reconnecting…</span>
  if (mine?.hidden) return <span className="member-status">not looking (video paused)</span>
  if (mine?.stats && mine.mediaState === 'streaming') {
    const { fps, latencyMs, transport, packetLossPct } = mine.stats
    return (
      <span className="member-status">
        watching you · {fps} fps ·{' '}
        <span className={`lat ${latencyClass(latencyMs)}`}>{latencyMs === null ? '–' : `${latencyMs} ms`}</span>
        {transport === 'tcp' ? ' · TCP' : ''}
        {packetLossPct >= 1 ? ` · ${packetLossPct.toFixed(1)}% loss` : ''}
      </span>
    )
  }
  if (mine) return <span className="member-status">watching you</span>
  return null
}
