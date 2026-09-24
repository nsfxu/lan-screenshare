import { useMemo, useState, type FormEvent } from 'react'
import type { DiscoveredRoom, Settings } from '../../shared/types'
import { errorMessage, formatDuration } from '../lib/format'
import { Icon } from './Icon'

interface Props {
  settings: Settings
  rooms: DiscoveredRoom[]
  busyKey: string | null
  onJoin(room: DiscoveredRoom): void
  onCreate(): void
  onSettings(): void
  onRename(name: string): void
}

/** Room list with live mDNS discovery, search, and manual IP entry for VPNs. */
export function HomeScreen({ settings, rooms, busyKey, onJoin, onCreate, onSettings, onRename }: Props) {
  const [query, setQuery] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rooms
    return rooms.filter((r) => `${r.name} ${r.hostName} ${r.address}`.toLowerCase().includes(q))
  }, [rooms, query])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    await window.api.rooms.refresh().catch(() => {})
    setTimeout(() => setRefreshing(false), 600)
  }

  return (
    <div className="home">
      <header className="home-header">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="screen" size={20} />
          </div>
          <div>
            <h1>ScreenShare</h1>
            <p className="muted">Share your screen with people on your network</p>
          </div>
        </div>
        <div className="header-actions">
          <NameEditor name={settings.displayName} onSave={onRename} />
          <button className="icon-btn" title="Settings" onClick={onSettings}>
            <Icon name="settings" size={18} />
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input
            placeholder="Search rooms"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search rooms"
          />
        </div>
        <button className="btn ghost" onClick={refresh} title="Scan the network again">
          <Icon name="refresh" className={refreshing ? 'spin' : ''} /> Refresh
        </button>
        <button className="btn ghost" onClick={() => setManualOpen((v) => !v)}>
          <Icon name="network" /> Connect by IP
        </button>
        <button className="btn primary" onClick={onCreate}>
          <Icon name="plus" /> Create room
        </button>
      </div>

      {manualOpen && <ManualConnect onClose={() => setManualOpen(false)} />}

      <section className="room-section">
        <div className="section-title">
          <h2>Rooms on your network</h2>
          <span className="live-dot" title="Listening for rooms via mDNS" /> <span className="muted small">live</span>
        </div>
        {filtered.length === 0 ? (
          <div className="empty">
            <Icon name="screen" size={40} />
            <h3>{rooms.length === 0 ? 'No rooms found yet' : 'No rooms match your search'}</h3>
            <p className="muted">
              {rooms.length === 0
                ? 'Rooms hosted on this LAN appear here automatically. On a VPN or a different subnet, use “Connect by IP”.'
                : 'Try a different name.'}
            </p>
            {rooms.length === 0 && (
              <button className="btn primary" onClick={onCreate}>
                <Icon name="plus" /> Create a room
              </button>
            )}
          </div>
        ) : (
          <div className="room-grid">
            {filtered.map((room) => (
              <RoomCard key={room.key} room={room} busy={busyKey === room.key} onJoin={() => onJoin(room)} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function RoomCard({ room, busy, onJoin }: { room: DiscoveredRoom; busy: boolean; onJoin(): void }) {
  const full = room.maxUsers > 0 && room.viewerCount + 1 >= room.maxUsers
  const status = !room.reachable ? 'Unreachable' : !room.sharing ? 'Not sharing yet' : room.paused ? 'Paused' : 'Live'
  return (
    <article className={`room-card ${room.reachable ? '' : 'offline'}`}>
      <div className="room-card-top">
        <span className={`badge ${room.privacy}`}>
          <Icon name={room.privacy === 'private' ? 'lock' : 'globe'} size={12} />
          {room.privacy === 'private' ? 'Private' : 'Public'}
        </span>
        <span className={`status-pill ${status === 'Live' ? 'live' : ''}`}>{status}</span>
      </div>
      <h3 title={room.name}>{room.name}</h3>
      <p className="muted small">
        {room.hostName ? `Hosted by ${room.hostName}` : 'Unknown host'}
        {room.startedAt > 0 && room.reachable ? ` · ${formatDuration(Date.now() - room.startedAt)}` : ''}
      </p>
      <div className="room-card-meta">
        <span title="Viewers">
          <Icon name="users" size={14} /> {room.viewerCount}
          {room.maxUsers ? ` / ${room.maxUsers - 1}` : ''}
        </span>
        <span className="mono small muted" title={room.source === 'mdns' ? 'Discovered via mDNS' : 'Added manually'}>
          {room.address}:{room.port}
          {room.tls ? ' · TLS' : ''}
        </span>
      </div>
      <div className="room-card-actions">
        {room.source === 'manual' && (
          <button
            className="btn ghost small"
            title="Remove from list"
            onClick={() => void window.api.rooms.removeManual(room.key)}
          >
            <Icon name="trash" size={14} />
          </button>
        )}
        <button className="btn primary small" disabled={!room.reachable || busy || full} onClick={onJoin}>
          {busy ? 'Joining…' : full ? 'Full' : 'Join'}
        </button>
      </div>
    </article>
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
      <Icon name="network" />
      <input
        autoFocus
        placeholder="Host address, e.g. 10.8.0.5 or 192.168.1.20:47800"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="btn primary small" disabled={busy}>
        {busy ? 'Checking…' : 'Add'}
      </button>
      <button type="button" className="icon-btn" onClick={onClose} title="Close">
        <Icon name="x" />
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  )
}

function NameEditor({ name, onSave }: { name: string; onSave(name: string): void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  if (!editing) {
    return (
      <button className="name-chip" title="Change your display name" onClick={() => (setValue(name), setEditing(true))}>
        <span className="avatar tiny">{name.slice(0, 1).toUpperCase()}</span>
        {name}
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
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}
