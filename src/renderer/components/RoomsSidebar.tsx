import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH, PROTOCOL_VERSION } from '../../shared/constants'
import { onePerRoom, sameEndpoint } from '../../shared/roomList'
import type { DiscoveredRoom, RoomEndpoint, Settings, VpnStatus } from '../../shared/types'
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

/** A private room asking for its PIN, shown as a small form under the room's row. */
export interface PinPrompt {
  /** Key (address:port) of the room's row. */
  key: string
  roomName: string
  hostName: string
  error: string | null
  lockedUntil: number | null
}

interface Props {
  settings: Settings
  rooms: DiscoveredRoom[]
  current: CurrentRoom | null
  /** Who's in the current room, shown under it. */
  members: ReactNode
  pin: PinPrompt | null
  onPinSubmit(pin: string): void
  onPinCancel(): void
  /** Key (address:port) of the room being joined right now. */
  busyKey: string | null
  collapsed: boolean
  /** Shown over the room (narrow window) rather than beside it. */
  floating?: boolean
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
  // One row per room, even when it answers on several addresses; recent and current rooms aren't repeated.
  const shown = new Set([current?.id, ...recent.map((row) => row.room?.id)].filter(Boolean))
  const network: Row[] = onePerRoom(rooms)
    .filter((r) => !settings.recentRooms.some((ep) => sameEndpoint(r, ep)) && !(r.id && shown.has(r.id)))
    .map((r) => ({ key: r.key, name: r.name, room: r, endpoint: { address: r.address, port: r.port, tls: r.tls, name: r.name } }))

  const pinForm = props.pin && (
    <PinForm prompt={props.pin} busy={props.busyKey === props.pin.key} onSubmit={props.onPinSubmit} onCancel={props.onPinCancel} />
  )

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
    <nav className={`rooms-sidebar ${props.floating ? 'floating' : ''}`} aria-label="Rooms">
      <div className="rooms-actions">
        <button className="btn primary small" onClick={props.onCreate}>
          <Icon name="plus" size={14} /> Create room
        </button>
        <button
          className={`btn small ${manualOpen ? 'active' : ''}`}
          title="Join a room by its address, e.g. over a VPN"
          aria-expanded={manualOpen}
          onClick={() => setManualOpen((v) => !v)}
        >
          <Icon name="network" size={14} /> Join by IP
        </button>
        <button className="icon-btn" title="Hide rooms" aria-label="Hide rooms" onClick={onToggle}>
          <Icon name="panelLeft" />
        </button>
      </div>
      {manualOpen && (
        <ManualConnect
          onClose={() => setManualOpen(false)}
          onVpnRoom={(room) => {
            setManualOpen(false)
            props.onJoin(room)
          }}
        />
      )}
      <VpnStatusBar />

      <div className="rooms-scroll">
        {/* A room that asks for a PIN but isn't in the list (e.g. rejoining the last room at startup). */}
        {props.pin && ![...recent, ...network].some((row) => row.key === props.pin!.key) && pinForm}
        {(current || recent.length > 0) && (
          <section className="rooms-group">
            <h3 className="rooms-group-title">Recent rooms</h3>
            {/* Your own room, or one just joined that isn't in the recent rooms yet. */}
            {current && !recent.some((row) => isCurrent(row.endpoint)) && (
              <CurrentRow current={current} members={props.members} />
            )}
            {recent.map((row) =>
              isCurrent(row.endpoint) && current ? (
                <CurrentRow key={row.key} current={current} members={props.members} />
              ) : (
                <div key={row.key}>
                  <RoomRow
                    row={row}
                    busy={props.busyKey === row.key}
                    onJoin={() => (row.room?.reachable ? props.onJoin(row.room) : props.onJoinEndpoint(row.endpoint))}
                    onRemove={() => props.onForgetRecent(row.endpoint)}
                    removeLabel="Forget this room"
                  />
                  {props.pin?.key === row.key && pinForm}
                </div>
              )
            )}
          </section>
        )}

        <section className="rooms-group">
          <h3 className="rooms-group-title">
            Rooms on your network <span className="live-dot" title="Listening for rooms on your network" />
            <button
              className="icon-btn rooms-refresh"
              title="Scan the network again"
              aria-label="Refresh"
              onClick={() => void refresh()}
            >
              <Icon name="refresh" size={13} className={refreshing ? 'spin' : ''} />
            </button>
          </h3>
          {network.length === 0 ? (
            <p className="muted small rooms-empty">
              {rooms.length === 0
                ? 'Rooms on this network show up here by themselves. On a VPN, use Join by IP.'
                : 'No other rooms right now.'}
            </p>
          ) : (
            network.map((row) => (
              <div key={row.key}>
                <RoomRow
                  row={row}
                  busy={props.busyKey === row.key}
                  onJoin={() => row.room && props.onJoin(row.room)}
                  onRemove={row.room?.source === 'manual' ? () => void window.api.rooms.removeManual(row.key) : undefined}
                  removeLabel="Remove from list"
                />
                {props.pin?.key === row.key && pinForm}
              </div>
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

function CurrentRow({ current, members }: { current: CurrentRoom; members: ReactNode }) {
  return (
    <div className="current-room">
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
      {members}
    </div>
  )
}

function PinForm({
  prompt,
  busy,
  onSubmit,
  onCancel
}: {
  prompt: PinPrompt
  busy: boolean
  onSubmit(pin: string): void
  onCancel(): void
}) {
  const [pin, setPin] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!prompt.lockedUntil) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [prompt.lockedUntil])
  const lockedFor = prompt.lockedUntil ? Math.max(0, prompt.lockedUntil - now) : 0
  const valid = new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin)

  return (
    <form
      className="pin-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid && !lockedFor) onSubmit(pin)
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <p className="muted small">
        <Icon name="lock" size={12} /> {prompt.roomName} is private. Ask {prompt.hostName || 'the host'} for the PIN.
      </p>
      <div className="pin-form-row">
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="off"
          maxLength={PIN_MAX_LENGTH}
          placeholder="PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          aria-label="Room PIN"
        />
        <button className="btn primary small" disabled={!valid || busy || lockedFor > 0}>
          {busy ? 'Joining…' : 'Join'}
        </button>
        <button type="button" className="icon-btn" title="Cancel" aria-label="Cancel" onClick={onCancel}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {lockedFor > 0 ? (
        <p className="error-text">Too many wrong attempts. Try again in {Math.ceil(lockedFor / 1000)} s.</p>
      ) : (
        prompt.error && <p className="error-text">{prompt.error}</p>
      )}
    </form>
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

function ManualConnect({ onClose, onVpnRoom }: { onClose(): void; onVpnRoom(room: DiscoveredRoom): void }) {
  const [mode, setMode] = useState<'address' | 'vpn'>('address')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!value.trim()) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'vpn') {
        // Enrols, brings the tunnel up (asks for the administrator password) and finds the room through it.
        const room = await window.api.vpn.join(value.trim())
        setValue('')
        onVpnRoom(room)
      } else {
        await window.api.rooms.addManual(value.trim())
        setValue('')
        onClose()
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="manual-connect" onSubmit={submit}>
      <div className="segmented full">
        <button type="button" className={mode === 'address' ? 'active' : ''} onClick={() => (setMode('address'), setError(null))}>
          Direct
        </button>
        <button type="button" className={mode === 'vpn' ? 'active' : ''} onClick={() => (setMode('vpn'), setError(null))}>
          VPN invite
        </button>
      </div>
      <input
        autoFocus
        aria-label={mode === 'vpn' ? 'VPN invite' : 'Host address'}
        placeholder={mode === 'vpn' ? 'Paste the invite the host sent you' : 'Host address, e.g. 10.8.0.5 or 192.168.1.20:47800'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="btn primary small" disabled={busy}>
        {mode === 'vpn' ? (busy ? 'Connecting…' : 'Connect') : busy ? 'Checking…' : 'Add'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  )
}

/** Shown while this app is in a VPN room someone else opened, with a way out. */
function VpnStatusBar() {
  const [status, setStatus] = useState<VpnStatus | null>(null)
  useEffect(() => {
    void window.api.vpn.status().then(setStatus)
    return window.api.vpn.onChanged(setStatus)
  }, [])
  if (status?.mode !== 'joined') return null
  return (
    <div className="vpn-status">
      <Icon name="network" size={14} />
      <span title={`Interface ${status.interface ?? ''}`}>
        VPN connected · <span className="mono">{status.address}</span>
      </span>
      <button className="btn small" onClick={() => void window.api.vpn.leave()}>
        Disconnect
      </button>
    </div>
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
