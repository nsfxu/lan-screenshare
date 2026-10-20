import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH, PROTOCOL_VERSION, ROOM_NAME_MAX_LENGTH } from '../../shared/constants'
import { roomListRows, sameEndpoint, type RoomRow as Row } from '../../shared/roomList'
import type { DiscoveredRoom, RoomEndpoint, Settings } from '../../shared/types'
import { errorMessage, formatDuration } from '../lib/format'
import { useT } from '../lib/i18n'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { Menu, type MenuAt, type MenuItem } from './Menu'
import { RoomAvatar, RoomDetails, useRoomLabel, useRoomStatus } from './RoomIdentity'

/** The room you're in, as the sidebar shows it. */
export interface CurrentRoom {
  /** The room's id: the same room can be listed under several addresses (LAN, VPN, by IP). */
  id: string
  name: string
  /** Where it was joined from; null for your own room (you host it). */
  endpoint: RoomEndpoint | null
  people: number
  live: number
  /** Who hosts it, for its picture; null until the room says. */
  host: { name: string; color: string; image: string | null } | null
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
  onPinRecent(endpoint: RoomEndpoint, pinned: boolean): void
  /** Your own name for a recent room ('' for the room's own); `roomName` is what the room calls itself. */
  onRenameRecent(endpoint: RoomEndpoint, name: string, roomName: string | undefined): void
  onToast(message: string): void
  onCreate(): void
  onSettings(): void
  onRename(name: string): void
}

/**
 * The left column: create or find rooms (the ones you've been in first, then the rest of the
 * network), and who you are at the bottom.
 */
export function RoomsSidebar(props: Props) {
  const { settings, rooms, current, collapsed, onToggle } = props
  const { t, rich } = useT()
  const [manualOpen, setManualOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [offlineOpen, setOfflineOpen] = useState(false)

  const isCurrent = (ep: RoomEndpoint): boolean => !!current?.endpoint && sameEndpoint(current.endpoint, ep)
  const groups = roomListRows(
    settings.recentRooms,
    rooms,
    current?.id ?? null,
    (row) => !isCurrent(row.endpoint) && isOffline(row.room)
  )
  const all = [...groups.recent, ...groups.offline, ...groups.network]

  const pinForm = props.pin && (
    <PinForm prompt={props.pin} busy={props.busyKey === props.pin.key} onSubmit={props.onPinSubmit} onCancel={props.onPinCancel} />
  )
  const join = (row: Row<DiscoveredRoom>): void =>
    row.room?.reachable ? props.onJoin(row.room) : props.onJoinEndpoint(row.endpoint)
  const recentRow = (row: Row<DiscoveredRoom>) =>
    isCurrent(row.endpoint) && current ? (
      // Your name for it, and its pin, show while you're inside too.
      <CurrentRow key={row.key} current={{ ...current, name: row.name }} pinned={!!row.endpoint.pinned} members={props.members} />
    ) : (
      <div key={row.key}>
        <RoomRow
          row={row}
          busy={props.busyKey === row.key}
          onJoin={() => join(row)}
          remembered={{
            onPin: (pinned) => props.onPinRecent(row.endpoint, pinned),
            onRename: (name) => props.onRenameRecent(row.endpoint, name, row.room?.name || row.endpoint.name),
            onCopyAddress: () =>
              void window.api.system
                .copyText(`${row.endpoint.address}:${row.endpoint.port}`)
                .then(() => props.onToast(t('common.addressCopied'))),
            onForget: () => props.onForgetRecent(row.endpoint)
          }}
        />
        {props.pin?.key === row.key && pinForm}
      </div>
    )

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    await window.api.rooms.refresh().catch(() => {})
    setTimeout(() => setRefreshing(false), 1200)
  }

  if (collapsed) {
    return (
      <nav className="rooms-sidebar collapsed" aria-label={t('rooms.label')}>
        <button className="icon-btn" title={t('rooms.show')} aria-label={t('rooms.show')} onClick={onToggle}>
          <Icon name="panelLeft" size={18} />
        </button>
        <button
          className="icon-btn"
          title={t('common.createRoom')}
          aria-label={t('common.createRoom')}
          onClick={props.onCreate}
        >
          <Icon name="plus" size={18} />
        </button>
        <div className="rooms-strip">
          {current && !current.endpoint && <RoomBadge name={current.name} active onClick={() => {}} />}
          {all.map((row) => (
            <RoomBadge
              key={row.key}
              name={row.name}
              active={isCurrent(row.endpoint)}
              live={(row.room?.reachable && row.room.streams > 0) || false}
              onClick={() => join(row)}
            />
          ))}
        </div>
        <button className="icon-btn" title={t('common.settings')} aria-label={t('common.settings')} onClick={props.onSettings}>
          <Icon name="settings" size={18} />
        </button>
      </nav>
    )
  }

  return (
    <nav className={`rooms-sidebar ${props.floating ? 'floating' : ''}`} aria-label={t('rooms.label')}>
      <div className="rooms-actions">
        <button className="btn primary small" onClick={props.onCreate}>
          <Icon name="plus" size={14} /> {t('common.createRoom')}
        </button>
        <button
          className={`btn small ${manualOpen ? 'active' : ''}`}
          title={t('rooms.joinByIpTip')}
          aria-expanded={manualOpen}
          onClick={() => setManualOpen((v) => !v)}
        >
          <Icon name="network" size={14} /> {t('common.joinByIp')}
        </button>
        <button className="icon-btn" title={t('rooms.hide')} aria-label={t('rooms.hide')} onClick={onToggle}>
          <Icon name="panelLeft" />
        </button>
      </div>
      {manualOpen && <ManualConnect onClose={() => setManualOpen(false)} />}

      <div className="rooms-scroll">
        {/* A room that asks for a PIN but isn't in the list (e.g. rejoining the last room at startup). */}
        {props.pin && !all.some((row) => row.key === props.pin!.key) && pinForm}
        {(current || settings.recentRooms.length > 0) && (
          <section className="rooms-group">
            <h3 className="rooms-group-title">{t('rooms.recent')}</h3>
            {/* Your own room, or one just joined that isn't in the recent rooms yet. */}
            {current && !groups.recent.some((row) => isCurrent(row.endpoint)) && (
              <CurrentRow current={current} members={props.members} />
            )}
            {groups.recent.map(recentRow)}
            {groups.offline.length > 0 && (
              <>
                <button
                  className="rooms-offline-toggle"
                  aria-expanded={offlineOpen}
                  onClick={() => setOfflineOpen((v) => !v)}
                >
                  <Icon name={offlineOpen ? 'chevronDown' : 'chevronRight'} size={14} />
                  {t('rooms.offlineGroup', { count: groups.offline.length })}
                </button>
                {/* A room asking for its PIN stays visible while the group is folded. */}
                {groups.offline.filter((row) => offlineOpen || props.pin?.key === row.key).map(recentRow)}
              </>
            )}
          </section>
        )}

        <section className="rooms-group">
          <h3 className="rooms-group-title">
            {t('rooms.onNetwork')}
            <button
              className="rooms-refresh"
              title={t('rooms.scanAgain')}
              aria-label={t('rooms.refresh')}
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              <Icon name="refresh" size={13} className={refreshing ? 'spin' : ''} />
              {refreshing && t('rooms.scanning')}
            </button>
          </h3>
          {groups.network.length === 0 && <p className="muted small rooms-empty">{t('rooms.noneFound')}</p>}
          {groups.network.map((row) => (
            <div key={row.key}>
              <RoomRow
                row={row}
                busy={props.busyKey === row.key}
                onJoin={() => row.room && props.onJoin(row.room)}
                onRemove={row.room?.source === 'manual' ? () => void window.api.rooms.removeManual(row.key) : undefined}
                removeLabel={t('rooms.removeFromList')}
              />
              {props.pin?.key === row.key && pinForm}
            </div>
          ))}
          <p className="muted small rooms-hint">
            {rich('rooms.hint', {
              joinByIp: (
                <button className="link-btn" onClick={() => setManualOpen(true)}>
                  {t('rooms.hintJoinByIp')}
                </button>
              )
            })}
          </p>
        </section>
      </div>

      <div className="user-panel">
        <NameEditor name={settings.displayName} avatar={settings.avatar} onSave={props.onRename} />
        <button className="icon-btn" title={t('common.settings')} aria-label={t('common.settings')} onClick={props.onSettings}>
          <Icon name="settings" size={18} />
        </button>
      </div>
    </nav>
  )
}

/**
 * A remembered room that doesn't answer right now. Rooms on another version do answer (they're
 * listed with what to update instead), so they aren't offline.
 */
function isOffline(room: DiscoveredRoom | null): boolean {
  return !room || (!room.reachable && (room.protocol === 0 || room.protocol === PROTOCOL_VERSION))
}

function CurrentRow({ current, pinned = false, members }: { current: CurrentRoom; pinned?: boolean; members: ReactNode }) {
  const { t } = useT()
  return (
    <div className="current-room">
      <div className="room-row current" aria-current="true">
        <RoomAvatar name={current.name} host={current.host} live={current.live > 0} />
        <span className="room-row-text">
          <span className="room-row-name" title={current.name}>
            {pinned && <PinMark />}
            {current.name}
          </span>
          <span className="room-details">
            {t('rooms.people', { count: current.people })}
            {/* The live dot and the accent edge say these to the eye. */}
            <span className="sr-only">
              {current.live > 0 && `, ${t('rooms.liveTag')}`}, {t('rooms.youreHere')}
            </span>
          </span>
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
  const { t } = useT()
  const [pin, setPin] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!prompt.lockedUntil) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
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
        <Icon name="lock" size={12} />{' '}
        {t('rooms.pinPrompt', { room: prompt.roomName, host: prompt.hostName || t('rooms.pinTheHost') })}
      </p>
      <div className="pin-form-row">
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="off"
          maxLength={PIN_MAX_LENGTH}
          placeholder={t('rooms.pinPlaceholder')}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          aria-label={t('rooms.pinLabel')}
        />
        <button className="btn primary small" disabled={!valid || busy || lockedFor > 0}>
          {busy ? t('rooms.joining') : t('rooms.pinJoin')}
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t('common.cancel')}
          aria-label={t('common.cancel')}
          onClick={onCancel}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      {lockedFor > 0 ? (
        <p className="error-text">{t('rooms.pinLocked', { seconds: Math.ceil(lockedFor / 1000) })}</p>
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
  removeLabel,
  remembered
}: {
  row: Row<DiscoveredRoom>
  busy: boolean
  onJoin(): void
  /** A room added by IP: the x takes it off the list. */
  onRemove?: () => void
  removeLabel?: string
  /** A room you've been in: its menu (the dots, or a right-click) pins, renames, copies the address or forgets it. */
  remembered?: {
    onPin(pinned: boolean): void
    onRename(name: string): void
    onCopyAddress(): void
    onForget(): void
  }
}) {
  const { t, ago } = useT()
  const { room } = row
  const status = useRoomStatus(room)
  const roomLabel = useRoomLabel()
  const [menuAt, setMenuAt] = useState<MenuAt | null>(null)
  const [renaming, setRenaming] = useState(false)
  const pinned = !!row.endpoint.pinned
  // What the room calls itself, when you gave it a name of your own.
  const roomName = row.endpoint.nickname ? room?.name || row.endpoint.name : undefined
  const title = [
    row.name,
    roomName && t('rooms.roomName', { name: roomName }),
    (room?.hostName || row.endpoint.host?.name) && t('rooms.hostedBy', { name: room?.hostName || row.endpoint.host!.name }),
    room?.startedAt && room.reachable ? t('rooms.openFor', { duration: formatDuration(Date.now() - room.startedAt) }) : null,
    `${row.endpoint.address}:${row.endpoint.port}${row.endpoint.tls ? ' · TLS' : ''}`,
    status.versionProblem
  ]
    .filter(Boolean)
    .join('\n')
  const answering = room && !status.offline ? room : null
  let details: ReactNode
  if (answering) details = <RoomDetails room={answering} status={status} busy={busy} />
  else {
    const when = row.endpoint.lastVisited
    details = (
      <span className="room-details">
        {busy ? t('rooms.joining') : when ? t('rooms.lastVisited', { when: ago(when) }) : t('rooms.offline')}
      </span>
    )
  }

  const avatar = (
    <RoomAvatar
      name={row.name}
      host={answering ? { name: answering.hostName, color: answering.hostColor, image: answering.hostImage } : row.endpoint.host}
      live={!!answering && answering.streams > 0}
      locked={answering?.privacy === 'private'}
    />
  )
  if (renaming && remembered) {
    return (
      <div className={`room-row renaming ${status.offline ? 'offline' : ''}`}>
        <div className="room-row-main">
          {avatar}
          <RenameField
            name={row.name}
            roomName={roomName ?? row.name}
            onDone={(name) => {
              setRenaming(false)
              if (name !== null) remembered.onRename(name)
            }}
          />
        </div>
      </div>
    )
  }

  const items: MenuItem[] = remembered
    ? [
        { label: pinned ? t('rooms.unpin') : t('rooms.pin'), icon: 'pin', onSelect: () => remembered.onPin(!pinned) },
        { label: t('rooms.rename'), icon: 'pen', onSelect: () => setRenaming(true) },
        { label: t('common.copyAddress'), icon: 'copy', onSelect: remembered.onCopyAddress },
        { kind: 'separator' },
        { label: t('rooms.forget'), icon: 'x', danger: true, onSelect: remembered.onForget }
      ]
    : []
  return (
    <div
      className={`room-row ${status.offline ? 'offline' : ''} ${menuAt ? 'menu-open' : ''}`}
      onContextMenu={
        remembered
          ? (e) => {
              e.preventDefault()
              setMenuAt({ x: e.clientX, y: e.clientY })
            }
          : undefined
      }
    >
      <button
        className="room-row-main"
        title={title}
        disabled={busy || status.full || !!status.versionProblem}
        onClick={onJoin}
        aria-label={[roomLabel(room, row.name, status), pinned && t('rooms.pinned')].filter(Boolean).join(', ')}
      >
        {avatar}
        <span className="room-row-text">
          <span className="room-row-name">
            {pinned && <PinMark />}
            {row.name}
          </span>
          {details}
        </span>
      </button>
      {remembered && (
        <button
          className="icon-btn room-row-more"
          title={t('rooms.more', { name: row.name })}
          aria-label={t('rooms.more', { name: row.name })}
          aria-haspopup="menu"
          aria-expanded={!!menuAt}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setMenuAt((open) => (open ? null : { x: rect.left, y: rect.bottom + 4 }))
          }}
        >
          <Icon name="more" size={15} stroke={2.6} />
        </button>
      )}
      {menuAt && <Menu items={items} at={menuAt} label={row.name} onClose={() => setMenuAt(null)} />}
      {onRemove && (
        <button className="icon-btn room-row-remove" title={removeLabel} aria-label={removeLabel} onClick={onRemove}>
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  )
}

/** Before a pinned room's name; screen readers hear "Pinned" from the row's label. */
function PinMark() {
  return (
    <span className="room-pin" aria-hidden="true">
      <Icon name="pin" size={11} stroke={2.2} />
    </span>
  )
}

/** Your own name for a room, typed in place of its name: Enter or leaving the field saves, Esc cancels. */
function RenameField({ name, roomName, onDone }: { name: string; roomName: string; onDone(name: string | null): void }) {
  const { t } = useT()
  const [value, setValue] = useState(name)
  const done = useRef(false)
  const finish = (result: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(result)
  }
  return (
    <span className="room-row-text">
      <input
        className="room-rename"
        autoFocus
        aria-label={t('rooms.renameLabel')}
        aria-describedby="room-rename-hint"
        value={value}
        maxLength={ROOM_NAME_MAX_LENGTH}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(value)
          if (e.key === 'Escape') {
            // Only this field: the rooms column stays open.
            e.stopPropagation()
            finish(null)
          }
        }}
      />
      <span id="room-rename-hint" className="room-details">
        {t('rooms.renameHint', { name: roomName })}
      </span>
    </span>
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
  const { t } = useT()
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
        placeholder={t('rooms.manualPlaceholder')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="btn primary small" disabled={busy}>
        {busy ? t('rooms.manualChecking') : t('rooms.manualAdd')}
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  )
}

function NameEditor({ name, avatar, onSave }: { name: string; avatar: string | null; onSave(name: string): void }) {
  const { t } = useT()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  if (!editing) {
    return (
      <button className="user-chip" title={t('rooms.changeName')} onClick={() => (setValue(name), setEditing(true))}>
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
      aria-label={t('rooms.nameLabel')}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}
