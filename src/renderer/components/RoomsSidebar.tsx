import { useState, type FormEvent } from 'react'
import { PROTOCOL_VERSION } from '../../shared/constants'
import { sameEndpoint } from '../../shared/recentRooms'
import type { DiscoveredRoom, RoomEndpoint, Settings } from '../../shared/types'
import { incompatibleRoomMessage } from '../../shared/version'
import { useAppVersion } from '../lib/appVersion'
import { errorMessage, formatDuration } from '../lib/format'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

/** The room you're in, as the sidebar shows it. */
export interface CurrentRoom {
  /** The room's id: the same room can be listed under several addresses (LAN, VPN, by IP). */
  id: string
  name: string
  /** Where it was joined from; null for your own room (you host it). */
  endpoint: RoomEndpoint | null
  people: number
  live: number
}

interface Props {
  settings: Settings
  rooms: DiscoveredRoom[]
  current: CurrentRoom | null
  /** Key (address:port) of the room being joined right now. */
  busyKey: string | null
  collapsed: boolean
  onToggle(): void
  onJoin(room: DiscoveredRoom): void
  /** A recent room that isn't in the list right now: try it anyway. */
  onJoinEndpoint(endpoint: RoomEndpoint): void
  onForgetRecent(endpoint: RoomEndpoint): void
  onCreate(): void
  onSettings(): void
  onRename(name: string): void
}

/** One line of the room list: a discovered room, or a remembered one that isn't answering. */
interface Row {
  key: string
  name: string
  room: DiscoveredRoom | null
  endpoint: RoomEndpoint
}

/**
 * The left column: create or find rooms (recent ones first, then the rest of
 * the network), and who you are at the bottom.
 */
export function RoomsSidebar(props: Props) {
  const { settings, rooms, current, collapsed, onToggle } = props
  const [manualOpen, setManualOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const isCurrent = (ep: RoomEndpoint): boolean => !!current?.endpoint && sameEndpoint(current.endpoint, ep)
  const recent: Row[] = settings.recentRooms.map((ep) => {
    const room = rooms.find((r) => sameEndpoint(r, ep)) ?? null
    return { key: `${ep.address}:${ep.port}`, name: room?.name || ep.name || `${ep.address}:${ep.port}`, room, endpoint: ep }
  })
  // One row per room, even when it answers on several addresses.
  const shown = new Set([current?.id, ...recent.map((row) => row.room?.id)].filter(Boolean))
  const network: Row[] = rooms
    .filter((r) => !settings.recentRooms.some((ep) => sameEndpoint(r, ep)) && !(r.id && shown.has(r.id)))
    .map((r) => ({ key: r.key, name: r.name, room: r, endpoint: { address: r.address, port: r.port, tls: r.tls, name: r.name } }))

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    await window.api.rooms.refresh().catch(() => {})
    setTimeout(() => setRefreshing(false), 600)
  }

  if (collapsed) {
    return (
      <nav className="rooms-sidebar collapsed" aria-label="Rooms">
        <button className="icon-btn" title="Show rooms" aria-label="Show rooms" onClick={onToggle}>
          <Icon name="panelLeft" size={18} />
        </button>
        <button className="icon-btn" title="Create room" aria-label="Create room" onClick={props.onCreate}>
          <Icon name="plus" size={18} />
        </button>
        <div className="rooms-strip">
          {current && !current.endpoint && <RoomBadge name={current.name} active onClick={() => {}} />}
          {[...recent, ...network].map((row) => (
            <RoomBadge
              key={row.key}
              name={row.name}
              active={isCurrent(row.endpoint)}
              live={(row.room?.reachable && row.room.streams > 0) || false}
              onClick={() => (row.room?.reachable ? props.onJoin(row.room) : props.onJoinEndpoint(row.endpoint))}
            />
          ))}
        </div>
        <button className="icon-btn" title="Settings" aria-label="Settings" onClick={props.onSettings}>
          <Icon name="settings" size={18} />
        </button>
      </nav>
    )
  }

  return (
    <nav className="rooms-sidebar" aria-label="Rooms">
      <div className="rooms-actions">
        <button className="btn primary small" onClick={props.onCreate}>
          <Icon name="plus" size={14} /> Create room
        </button>
        <button
          className={`icon-btn ${manualOpen ? 'active' : ''}`}
          title="Connect by IP"
          aria-label="Connect by IP"
          onClick={() => setManualOpen((v) => !v)}
        >
          <Icon name="network" />
        </button>
        <button className="icon-btn" title="Scan the network again" aria-label="Refresh" onClick={refresh}>
          <Icon name="refresh" className={refreshing ? 'spin' : ''} />
        </button>
        <span className="spacer" />
        <button className="icon-btn" title="Hide rooms" aria-label="Hide rooms" onClick={onToggle}>
          <Icon name="panelLeft" />
        </button>
      </div>
      {manualOpen && <ManualConnect onClose={() => setManualOpen(false)} />}

      <div className="rooms-scroll">
        {(current || recent.length > 0) && (
          <section className="rooms-group">
            <h3 className="rooms-group-title">Recent rooms</h3>
            {current && !current.endpoint && <CurrentRow current={current} />}
            {recent.map((row) =>
              isCurrent(row.endpoint) && current ? (
                <CurrentRow key={row.key} current={current} />
              ) : (
                <RoomRow
                  key={row.key}
                  row={row}
                  busy={props.busyKey === row.key}
                  onJoin={() => (row.room?.reachable ? props.onJoin(row.room) : props.onJoinEndpoint(row.endpoint))}
                  onRemove={() => props.onForgetRecent(row.endpoint)}
                  removeLabel="Forget this room"
                />
              )
            )}
          </section>
        )}

        <section className="rooms-group">
          <h3 className="rooms-group-title">
            Rooms on your network <span className="live-dot" title="Listening for rooms on your network" />
          </h3>
          {network.length === 0 ? (
            <p className="muted small rooms-empty">
              {rooms.length === 0
                ? 'Rooms on this network show up here by themselves. On a VPN, use Connect by IP.'
                : 'No other rooms right now.'}
            </p>
          ) : (
            network.map((row) => (
              <RoomRow
                key={row.key}
                row={row}
                busy={props.busyKey === row.key}
                onJoin={() => row.room && props.onJoin(row.room)}
                onRemove={row.room?.source === 'manual' ? () => void window.api.rooms.removeManual(row.key) : undefined}
                removeLabel="Remove from list"
              />
            ))
          )}
        </section>
      </div>

      <div className="user-panel">
        <NameEditor name={settings.displayName} avatar={settings.avatar} onSave={props.onRename} />
        <button className="icon-btn" title="Settings" aria-label="Settings" onClick={props.onSettings}>
          <Icon name="settings" size={18} />
        </button>
      </div>
    </nav>
  )
}

function CurrentRow({ current }: { current: CurrentRoom }) {
  return (
    <div className="room-row current" aria-current="true">
      <Icon name="screen" size={15} />
      <span className="room-row-name" title={current.name}>
        {current.name}
      </span>
      <span className="room-row-meta">
        {current.live > 0 && <span className="room-row-live">{current.live} live</span>}
        <Icon name="users" size={13} /> {current.people}
      </span>
    </div>
  )
}

function RoomRow({
  row,
  busy,
  onJoin,
  onRemove,
  removeLabel
}: {
  row: Row
  busy: boolean
  onJoin(): void
  onRemove?: () => void
  removeLabel: string
}) {
  const ours = useAppVersion()
  const { room } = row
  // Rooms on another protocol answer probes but can't be joined: say who has to update.
  const versionProblem = room ? incompatibleRoomMessage(room, { protocol: PROTOCOL_VERSION, appVersion: ours }) : null
  const full = !!room && room.maxUsers > 0 && room.viewerCount + 1 >= room.maxUsers
  const offline = !room || (!room.reachable && !versionProblem)
  const people = room ? room.viewerCount + 1 : 0
  const title = [
    row.name,
    room?.hostName && `Hosted by ${room.hostName}`,
    room?.startedAt && room.reachable ? `open for ${formatDuration(Date.now() - room.startedAt)}` : null,
    `${row.endpoint.address}:${row.endpoint.port}${row.endpoint.tls ? ' · TLS' : ''}`,
    versionProblem
  ]
    .filter(Boolean)
    .join('\n')

  let meta
  if (busy) meta = <span className="muted">Joining…</span>
  else if (versionProblem) meta = <span className="room-row-warn">{room!.protocol > PROTOCOL_VERSION ? 'Update to join' : 'Older version'}</span>
  else if (offline) meta = <span className="muted">offline</span>
  else if (full) meta = <span className="muted">Full</span>
  else
    meta = (
      <>
        {room!.streams > 0 && <span className="room-row-live">{room!.streams} live</span>}
        <Icon name="users" size={13} /> {people}
      </>
    )

  return (
    <div className={`room-row ${offline ? 'offline' : ''}`}>
      <button
        className="room-row-main"
        title={title}
        disabled={busy || full || !!versionProblem}
        onClick={onJoin}
        aria-label={`Join ${row.name}`}
      >
        <Icon name={room?.privacy === 'private' ? 'lock' : 'screen'} size={15} />
        <span className="room-row-name">{row.name}</span>
        <span className="room-row-meta">{meta}</span>
      </button>
      {onRemove && (
        <button className="icon-btn room-row-remove" title={removeLabel} aria-label={removeLabel} onClick={onRemove}>
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  )
}

/** A room in the collapsed sidebar: its first letter. */
function RoomBadge({ name, active, live, onClick }: { name: string; active: boolean; live?: boolean; onClick(): void }) {
  return (
    <button className={`room-badge ${active ? 'active' : ''}`} title={name} aria-label={name} onClick={onClick}>
      {name.slice(0, 1).toUpperCase()}
      {live && <span className="room-badge-live" />}
    </button>
  )
}

function ManualConnect({ onClose }: { onClose(): void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!value.trim()) return
    setBusy(true)
    setError(null)
    try {
      await window.api.rooms.addManual(value.trim())
      setValue('')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="manual-connect" onSubmit={submit}>
      <input
        autoFocus
        placeholder="Host address, e.g. 10.8.0.5 or 192.168.1.20:47800"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="btn primary small" disabled={busy}>
        {busy ? 'Checking…' : 'Add'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  )
}

function NameEditor({ name, avatar, onSave }: { name: string; avatar: string | null; onSave(name: string): void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  if (!editing) {
    return (
      <button className="user-chip" title="Change your display name" onClick={() => (setValue(name), setEditing(true))}>
        <Avatar name={name} image={avatar} />
        <span className="user-chip-name">{name}</span>
      </button>
    )
  }
  const commit = (): void => {
    const v = value.trim()
    if (v) onSave(v)
    setEditing(false)
  }
  return (
    <input
      className="name-input"
      autoFocus
      maxLength={32}
      value={value}
      aria-label="Your display name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}
