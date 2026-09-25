import { useEffect, useRef, useState } from 'react'
import { QUALITY_PRESETS, WATCH_QUALITIES, getWatchQuality, type WatchQualityId } from '../../shared/quality'
import type { ChatMessage, HostedRoom, HostStats, Participant, RoomState, Settings, ViewerStats } from '../../shared/types'
import {
  audioUnavailableMessage,
  DISCORD_NOT_EXCLUDED_MESSAGE,
  errorMessage,
  formatBitrate,
  formatDuration,
  latencyClass
} from '../lib/format'
import type { SharingState, WatcherInfo } from '../lib/publisher'
import type { ConnectionState } from '../lib/roomClient'
import type { Session } from '../lib/session'
import type { Subscription, SubscriptionState } from '../lib/subscription'
import { ChatPanel } from './ChatPanel'
import { ChangeSourceDialog } from './Dialogs'
import { Avatar } from './Avatar'
import { AccessPanel, HostStatsPanel } from './HostControls'
import { Icon } from './Icon'
import { ScreenViewer } from './ScreenViewer'
import { ViewerList } from './ViewerList'

interface Props {
  session: Session
  settings: Settings
  onLeave(reason?: string): void
  onOpenSettings(): void
  onChangeSettings(patch: Partial<Settings>): void
  onToast(message: string, tone?: 'error' | 'info'): void
}

const SELF = 'self'

/**
 * The in-room interface. Anyone can share; nothing is watched until the user
 * picks a stream. Watched streams (and your own, once you choose to show it)
 * are shown as tiles; focusing one puts it in the spotlight while the others
 * keep playing.
 */
export function RoomView({ session, settings, onLeave, onOpenSettings, onChangeSettings, onToast }: Props) {
  const { client, publisher, watches } = session
  const isHost = session.role === 'host'
  const [room, setRoom] = useState<RoomState | null>(client.room)
  const [participants, setParticipants] = useState<Participant[]>(client.participants)
  const [messages, setMessages] = useState<ChatMessage[]>(client.messages)
  const [connection, setConnection] = useState<ConnectionState>(client.state)
  const [ownStream, setOwnStream] = useState<MediaStream | null>(publisher.stream)
  const [ownSnapshot, setOwnSnapshot] = useState<string | null>(publisher.snapshot)
  // Your own stream isn't played back until you ask: rendering it costs GPU
  // time on the machine that is also capturing and encoding it.
  const [showSelf, setShowSelf] = useState(false)
  const [sharing, setSharing] = useState<SharingState>(publisher.state)
  const [ownStats, setOwnStats] = useState<HostStats | null>(null)
  const [myWatchers, setMyWatchers] = useState<ReadonlyMap<string, WatcherInfo>>(new Map())
  const [subs, setSubs] = useState<ReadonlyMap<string, Subscription>>(new Map(watches.all))
  const [focus, setFocus] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, string>>(new Map(client.snapshots))
  const [avatars, setAvatars] = useState<ReadonlyMap<string, string>>(new Map(client.avatars))
  const [hosted, setHosted] = useState<HostedRoom | null>(session.hosted)
  const [showStats, setShowStats] = useState(false)
  const [pickSource, setPickSource] = useState(false)
  const [, setNow] = useState(Date.now())
  const autoPaused = useRef(false)

  // --- subscriptions --------------------------------------------------------
  useEffect(() => {
    let lastCount = client.messages.length
    const offs = [
      client.on('room', setRoom),
      client.on('participants', setParticipants),
      client.on('snapshots', (m) => setSnapshots(new Map(m))),
      client.on('avatars', (m) => setAvatars(new Map(m))),
      client.on('state', setConnection),
      client.on('chat', (list) => {
        setMessages(list)
        const fresh = list.slice(lastCount)
        lastCount = list.length
        const incoming = fresh.filter((m) => !m.system && m.userId !== client.selfId)
        if (incoming.length && settings.notifications && !document.hasFocus()) {
          const m = incoming[incoming.length - 1]
          new Notification(m.name, { body: m.text, silent: false })
        }
      }),
      client.on('error', (e) => onToast(e.message, 'error')),
      client.on('closed', ({ reason }) => onLeave(reason))
    ]
    // Pictures and previews that arrived between the first render and now
    // (pictures are only sent once).
    setSnapshots(new Map(client.snapshots))
    setAvatars(new Map(client.avatars))
    return () => offs.forEach((o) => o())
  }, [client, settings.notifications, onLeave, onToast])

  useEffect(() => {
    const offs = [
      publisher.on('stream', setOwnStream),
      publisher.on('snapshot', setOwnSnapshot),
      publisher.on('sharing', setSharing),
      publisher.on('stats', setOwnStats),
      publisher.on('watchers', (m) => setMyWatchers(new Map(m))),
      publisher.on('stopped', (reason) => onToast(reason, 'info')),
      watches.on('changed', (m) => setSubs(new Map(m)))
    ]
    if (session.role === 'host') offs.push(window.api.host.onChanged((h) => h && setHosted(h)))
    return () => offs.forEach((o) => o())
  }, [session, publisher, watches, onToast])

  // A new share starts hidden again.
  useEffect(() => {
    if (!ownStream) setShowSelf(false)
  }, [ownStream])

  // Keep the focus on something that still exists.
  useEffect(() => {
    if (focus === SELF ? !(ownStream && showSelf) : focus !== null && !subs.has(focus)) setFocus(null)
  }, [focus, ownStream, showSelf, subs])

  // Nobody may record streams they watch: hide the window from screen capture
  // while watching anything.
  const watchingAny = subs.size > 0
  useEffect(() => {
    void window.api.system.setViewerProtection(watchingAny && !(room?.allowRecording ?? false))
    return () => void window.api.system.setViewerProtection(false)
  }, [watchingAny, room?.allowRecording])

  // Optional: pause our share while minimized, resume when restored.
  useEffect(() => {
    return window.api.system.onWindowState((state) => {
      if (!settings.pauseOnMinimize) return
      if (state === 'minimized' && publisher.sharing && !publisher.paused) {
        autoPaused.current = true
        publisher.setPaused(true)
      } else if (state === 'restored' && autoPaused.current) {
        autoPaused.current = false
        publisher.setPaused(false)
      }
    })
  }, [publisher, settings.pauseOnMinimize])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // --- actions ---------------------------------------------------------------
  const shareSource = async (id: string, audio: boolean, excludeDiscord: boolean): Promise<void> => {
    setPickSource(false)
    try {
      await publisher.startCapture(id, audio, excludeDiscord)
      if (audio && !publisher.hasAudio) onToast(audioUnavailableMessage(publisher.audioError), 'error')
      else if (publisher.discordExclusionFailed) onToast(DISCORD_NOT_EXCLUDED_MESSAGE, 'error')
    } catch (err) {
      onToast(`Could not capture: ${errorMessage(err)}`, 'error')
    }
  }

  const endRoom = (): void => {
    if (!confirm('End the room for everyone?')) return
    onLeave()
  }

  const byId = (id: string): Participant | undefined => participants.find((p) => p.id === id)
  const liveOthers = participants.filter((p) => p.stream && p.id !== client.selfId)
  const unwatched = liveOthers.filter((p) => !subs.has(p.id))
  const watcherCount = (id: string): number => participants.filter((p) => p.watching.includes(id)).length
  /** Sharing, but not showing our own stream: offer it next to the others. */
  const selfHidden = !!ownStream && !showSelf
  const me = byId(client.selfId)
  const selfPreview: PreviewInfo = {
    label: 'You',
    name: me?.name ?? settings.displayName,
    color: me?.color ?? 'var(--accent)',
    image: avatars.get(client.selfId) ?? settings.avatar,
    audio: sharing.hasAudio && !sharing.audioMuted,
    paused: sharing.paused
  }

  // --- stage -----------------------------------------------------------------
  const tiles: string[] = [...(ownStream && showSelf ? [SELF] : []), ...subs.keys()]
  const renderTile = (id: string, small: boolean) =>
    id === SELF ? (
      <SelfTile
        key={SELF}
        stream={ownStream}
        sharing={sharing}
        stats={ownStats}
        showOverlay={settings.showStatsOverlay}
        focused={focus === SELF}
        small={small}
        onFocus={() => setFocus(focus === SELF ? null : SELF)}
        onHide={() => setShowSelf(false)}
      />
    ) : (
      <RemoteTile
        key={id}
        sub={subs.get(id)!}
        participant={byId(id)}
        avatar={avatars.get(id) ?? null}
        snapshot={snapshots.get(id) ?? null}
        showOverlay={settings.showStatsOverlay}
        focused={focus === id}
        small={small}
        onFocus={() => setFocus(focus === id ? null : id)}
        onStop={() => watches.unwatch(id)}
      />
    )

  let stage
  if (tiles.length === 0) {
    stage = (
      <div className="stage-empty">
        {!selfHidden && liveOthers.length === 0 ? (
          <div className="placeholder-content">
            <Icon name="screen" size={40} />
            <h3>No one is sharing yet</h3>
            <p className="muted">Share your screen, or wait for someone else to.</p>
            <button className="btn primary" onClick={() => setPickSource(true)}>
              <Icon name="play" /> Share screen
            </button>
          </div>
        ) : (
          <div className="live-now">
            <div className="live-now-header">
              {liveOthers.length === 0 ? (
                <div>
                  <h3>You're sharing your screen</h3>
                  <p className="muted small">
                    Your own stream isn't played here, to save resources. Show it to see what others see.
                  </p>
                </div>
              ) : (
                <div>
                  <h3>
                    {selfHidden
                      ? `You and ${liveOthers.length === 1 ? '1 other person are' : `${liveOthers.length} others are`} sharing`
                      : liveOthers.length === 1
                        ? '1 person is sharing'
                        : `${liveOthers.length} people are sharing`}
                  </h3>
                  <p className="muted small">Nothing plays until you choose. Pick what you want to watch.</p>
                </div>
              )}
              {liveOthers.length > 1 && (
                <button className="btn" onClick={() => liveOthers.forEach((p) => watches.watch(p.id))}>
                  <Icon name="play" /> Watch all
                </button>
              )}
            </div>
            <div className="stream-cards">
              {selfHidden && (
                <StreamCard
                  key={SELF}
                  info={selfPreview}
                  snapshot={ownSnapshot}
                  watchers={watcherCount(client.selfId)}
                  action="Show"
                  title="Show your own stream"
                  onWatch={() => setShowSelf(true)}
                />
              )}
              {liveOthers.map((p) => (
                <StreamCard
                  key={p.id}
                  info={previewOf(p, avatars)}
                  snapshot={snapshots.get(p.id) ?? null}
                  watchers={watcherCount(p.id)}
                  onWatch={() => watches.watch(p.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  } else if (focus && tiles.includes(focus) && tiles.length > 1) {
    stage = (
      <div className="stage-spotlight">
        <div className="spotlight-main">{renderTile(focus, false)}</div>
        <div className="spotlight-strip">{tiles.filter((t) => t !== focus).map((t) => renderTile(t, true))}</div>
      </div>
    )
  } else {
    stage = <div className={`stage-grid count-${Math.min(tiles.length, 9)}`}>{tiles.map((t) => renderTile(t, false))}</div>
  }

  return (
    <div className="room">
      <header className="room-header">
        <div className="room-title">
          <h2 title={room?.name}>{room?.name ?? 'Room'}</h2>
          <span className={`badge ${room?.privacy ?? 'public'}`}>
            <Icon name={room?.privacy === 'private' ? 'lock' : 'globe'} size={12} />
            {room?.privacy === 'private' ? 'Private' : 'Public'}
          </span>
          {(room?.streams ?? 0) > 0 && (
            <span className="status-pill live">{room!.streams === 1 ? '1 live' : `${room!.streams} live`}</span>
          )}
          {connection === 'reconnecting' && <span className="status-pill warn">Reconnecting…</span>}
        </div>
        <div className="room-meta muted small">
          <span>
            <Icon name="users" size={13} /> {participants.length} in room
          </span>
          {room && <span>{formatDuration(Date.now() - room.startedAt)}</span>}
          {client.rttMs !== null && <span title="Round trip to the room server">RTT {Math.round(client.rttMs)} ms</span>}
          {!isHost && <span className="mono">{session.endpoint.address}</span>}
          <button className="icon-btn" title="Settings" onClick={onOpenSettings}>
            <Icon name="settings" size={16} />
          </button>
        </div>
      </header>

      <div className="room-body">
        <main className="stage">
          {tiles.length > 0 && (unwatched.length > 0 || selfHidden) && (
            <div className="stream-bar">
              <span className="muted small">Also live</span>
              {selfHidden && (
                <StreamChip
                  key={SELF}
                  info={selfPreview}
                  snapshot={ownSnapshot}
                  action="Show"
                  title="Show your own stream"
                  onWatch={() => setShowSelf(true)}
                />
              )}
              {unwatched.map((p) => (
                <StreamChip
                  key={p.id}
                  info={previewOf(p, avatars)}
                  snapshot={snapshots.get(p.id) ?? null}
                  onWatch={() => watches.watch(p.id)}
                />
              ))}
            </div>
          )}
          <div className="stage-area">{stage}</div>
          {showStats && sharing.sharing && (
            <div className="stats-popover">
              <HostStatsPanel stats={ownStats} />
            </div>
          )}
          <div className="stage-toolbar">
            {sharing.sharing ? (
              <>
                <button className="btn" onClick={() => publisher.setPaused(!sharing.paused)}>
                  <Icon name={sharing.paused ? 'play' : 'pause'} /> {sharing.paused ? 'Resume' : 'Pause'}
                </button>
                <button
                  className={`btn ${sharing.hasAudio && sharing.audioMuted ? 'active' : ''}`}
                  disabled={!sharing.hasAudio}
                  title={
                    !sharing.hasAudio
                      ? 'Audio is not being captured (enable it via Change source)'
                      : sharing.discordExcluded
                        ? 'Mute or unmute the system audio viewers hear (Discord is left out)'
                        : 'Mute or unmute the system audio viewers hear'
                  }
                  onClick={() => publisher.setAudioMuted(!sharing.audioMuted)}
                >
                  <Icon name={sharing.hasAudio && !sharing.audioMuted ? 'volume' : 'volumeOff'} />
                  {!sharing.hasAudio ? 'No audio' : sharing.audioMuted ? 'Unmute audio' : 'Mute audio'}
                </button>
                <button className="btn" onClick={() => setPickSource(true)}>
                  <Icon name="swap" /> Change source
                </button>
                <select
                  className="toolbar-select"
                  aria-label="Maximum quality you send"
                  title="Maximum quality you send (each viewer may get less: smaller tile, own choice, network)"
                  value={settings.maxQuality}
                  onChange={(e) => onChangeSettings({ maxQuality: e.target.value as Settings['maxQuality'] })}
                >
                  {QUALITY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button className="btn" onClick={() => publisher.stopSharing()}>
                  <Icon name="stop" /> Stop sharing
                </button>
                <button className={`btn ${showStats ? 'active' : ''}`} onClick={() => setShowStats((v) => !v)}>
                  <Icon name="chart" /> Stats
                </button>
              </>
            ) : (
              <button className="btn primary" onClick={() => setPickSource(true)}>
                <Icon name="play" /> Share screen
              </button>
            )}
            <span className="spacer" />
            {isHost ? (
              <button className="btn danger" onClick={endRoom}>
                <Icon name="logout" /> End room
              </button>
            ) : (
              <button className="btn danger" onClick={() => onLeave()}>
                <Icon name="logout" /> Leave
              </button>
            )}
          </div>
        </main>

        <aside className="sidebar">
          {isHost && hosted && <AccessPanel hosted={hosted} onToast={onToast} />}
          <ViewerList
            participants={participants}
            avatars={avatars}
            selfId={client.selfId}
            isHost={isHost}
            myWatchers={myWatchers}
            watching={new Set(subs.keys())}
            onWatch={(id) => watches.watch(id)}
            onUnwatch={(id) => watches.unwatch(id)}
            onKick={(id) => {
              const p = byId(id)
              if (p && confirm(`Remove ${p.name} from the room?`)) client.send({ type: 'kick', userId: id })
            }}
            onStopStream={(id) => {
              const p = byId(id)
              if (p && confirm(`Stop ${p.name}'s stream?`)) client.send({ type: 'stop-stream', userId: id })
            }}
          />
          <ChatPanel
            messages={messages}
            avatars={avatars}
            selfId={client.selfId}
            isHost={isHost}
            muted={!!room?.chatMuted}
            onSend={(text) => client.send({ type: 'chat', text })}
            onDelete={(id) => client.send({ type: 'delete-message', id })}
            onToggleMute={(muted) => client.send({ type: 'mute-chat', muted })}
          />
        </aside>
      </div>

      {pickSource && (
        <ChangeSourceDialog
          current={publisher.sourceId}
          currentAudio={publisher.sharing ? publisher.hasAudio : settings.shareAudio}
          currentExcludeDiscord={publisher.sharing ? publisher.excludeDiscord : settings.excludeDiscordAudio}
          onCancel={() => setPickSource(false)}
          onPick={(id, audio, excludeDiscord) => void shareSource(id, audio, excludeDiscord)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

/** What a stream card or chip shows about a live stream. */
interface PreviewInfo {
  /** Shown on the card ("You" for your own stream). */
  label: string
  /** Name the avatar initial comes from. */
  name: string
  color: string
  image: string | null
  audio: boolean
  paused: boolean
}

function previewOf(p: Participant, avatars: ReadonlyMap<string, string>): PreviewInfo {
  return {
    label: p.name,
    name: p.name,
    color: p.color,
    image: avatars.get(p.id) ?? null,
    audio: !!p.stream?.audio,
    paused: !!p.stream?.paused
  }
}

/** Preview card for a live stream the user isn't watching yet. */
function StreamCard({
  info,
  snapshot,
  watchers,
  action = 'Watch',
  title = `Watch ${info.label}'s stream`,
  onWatch
}: {
  info: PreviewInfo
  snapshot: string | null
  watchers: number
  action?: string
  title?: string
  onWatch(): void
}) {
  return (
    <button className="stream-card" onClick={onWatch} aria-label={title}>
      <div className="stream-card-thumb">
        {snapshot ? <img src={snapshot} alt="" /> : <Icon name="screen" size={32} />}
        {info.paused && <span className="stream-card-flag">Paused</span>}
        <span className="stream-card-play" aria-hidden="true">
          <Icon name="play" size={18} /> {action}
        </span>
      </div>
      <div className="stream-card-info">
        <Avatar name={info.name} color={info.color} image={info.image} size="tiny" />
        <span className="stream-card-name">{info.label}</span>
        {info.audio && <Icon name="volume" size={13} className="muted" />}
        <span className="muted small">{watchers === 0 ? 'no viewers' : `${watchers} watching`}</span>
      </div>
    </button>
  )
}

/** Compact "also live" entry above the stage. */
function StreamChip({
  info,
  snapshot,
  action = 'Watch',
  title = `Watch ${info.label}'s stream`,
  onWatch
}: {
  info: PreviewInfo
  snapshot: string | null
  action?: string
  title?: string
  onWatch(): void
}) {
  return (
    <button className="stream-chip" onClick={onWatch} title={title}>
      {snapshot ? (
        <img className="stream-chip-thumb" src={snapshot} alt="" />
      ) : (
        <Avatar name={info.name} color={info.color} image={info.image} size="tiny" />
      )}
      <span className="stream-chip-name">{info.label}</span>
      {info.audio && <Icon name="volume" size={12} />}
      {info.paused && <span className="muted small">paused</span>}
      <span className="stream-chip-action">
        <Icon name="play" size={12} /> {action}
      </span>
    </button>
  )
}

interface TileChrome {
  focused: boolean
  small: boolean
  showOverlay: boolean
  onFocus(): void
}

function SelfTile({
  stream,
  sharing,
  stats,
  showOverlay,
  focused,
  small,
  onFocus,
  onHide
}: TileChrome & { stream: MediaStream | null; sharing: SharingState; stats: HostStats | null; onHide(): void }) {
  const overlay =
    showOverlay && stats && !small ? (
      <div className="stat-badges">
        <span className="stat-badge">{Math.round(stats.fps)} fps</span>
        <span className="stat-badge">{formatBitrate(stats.bitrateKbps)}</span>
        <span className="stat-badge">{stats.viewers} watching</span>
        {sharing.hasAudio && (
          <span className={`stat-badge ${sharing.audioMuted ? 'muted-badge' : ''}`}>
            {sharing.audioMuted ? 'audio muted' : `audio ${stats.audioKbps ?? 0} kbps`}
          </span>
        )}
        <span className={`stat-badge ${stats.cpuPercent < 20 ? 'good' : 'ok'}`}>CPU {stats.cpuPercent.toFixed(0)}%</span>
      </div>
    ) : null
  return (
    <div className={`tile ${focused ? 'focused' : ''} ${small ? 'small' : ''}`}>
      <div className="tile-bar">
        <span className="tile-name">
          <Icon name="screen" size={13} /> Your screen
        </span>
        <TileButton focused={focused} onFocus={onFocus} />
        <button className="icon-btn" title="Hide your stream (you keep sharing)" onClick={onHide}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <ScreenViewer
        stream={stream}
        local
        overlay={overlay}
        placeholder={
          sharing.paused ? (
            <div className="placeholder-content paused">
              <Icon name="pause" size={28} />
              <h3>Sharing paused</h3>
            </div>
          ) : null
        }
      />
    </div>
  )
}

function RemoteTile({
  sub,
  participant,
  showOverlay,
  focused,
  small,
  onFocus,
  avatar,
  snapshot,
  onStop
}: TileChrome & {
  sub: Subscription
  participant: Participant | undefined
  avatar: string | null
  snapshot: string | null
  onStop(): void
}) {
  const [stream, setStream] = useState<MediaStream | null>(sub.stream)
  const [state, setState] = useState<SubscriptionState>(sub.state)
  const [stats, setStats] = useState<ViewerStats | null>(null)
  // Our quality choice for this streamer, remembered on this machine like the volume.
  const [quality, setQuality] = useState<WatchQualityId>(() => loadWatchQuality(participant?.name))
  useEffect(() => {
    setStream(sub.stream)
    setState(sub.state)
    const offs = [sub.on('stream', setStream), sub.on('state', setState), sub.on('stats', setStats)]
    return () => offs.forEach((o) => o())
  }, [sub])
  useEffect(() => sub.setQuality(quality), [sub, quality])

  const name = participant?.name ?? 'Someone'
  const paused = !!participant?.stream?.paused
  let placeholder = null
  if (paused) {
    placeholder = (
      <div className="placeholder-content paused">
        <Icon name="pause" size={28} />
        <h3>Paused by {name}</h3>
      </div>
    )
  } else if (state === 'negotiating' || !stream) {
    placeholder = (
      <>
        {snapshot && <div className="placeholder-bg" style={{ backgroundImage: `url(${snapshot})` }} />}
        <div className="placeholder-content">
          <div className="spinner" />
          <h3>Connecting to {name}…</h3>
        </div>
      </>
    )
  }

  const overlay =
    showOverlay && stats && state === 'streaming' && !small ? (
      <div className="stat-badges">
        <span className="stat-badge">{stats.fps} fps</span>
        <span className={`stat-badge ${latencyClass(stats.latencyMs)}`} title="Estimated glass-to-glass latency">
          {stats.latencyMs === null ? '– ms' : `~${stats.latencyMs} ms`}
        </span>
        <span className="stat-badge">
          {stats.width}×{stats.height}
        </span>
        <span className="stat-badge">
          {stats.codec || '…'} · {stats.transport === 'tcp' ? 'TCP' : 'WebRTC'}
        </span>
        {!participant?.stream?.audio && <span className="stat-badge muted-badge">no audio</span>}
      </div>
    ) : null

  return (
    <div className={`tile ${focused ? 'focused' : ''} ${small ? 'small' : ''}`}>
      <div className="tile-bar">
        <span className="tile-name">
          <Avatar name={name} color={participant?.color} image={avatar} size="tiny" />
          {name}
        </span>
        {!small && (
          <select
            className="tile-quality"
            aria-label={`Quality you receive from ${name}`}
            title={
              sub.transport === 'tcp'
                ? 'Quality you receive (on the TCP fallback the stream is shared with other TCP viewers, so you may get more)'
                : 'Quality you receive. Auto follows the size you watch at.'
            }
            value={quality}
            onChange={(e) => {
              const id = e.target.value as WatchQualityId
              setQuality(id)
              saveWatchQuality(participant?.name, id)
            }}
          >
            {WATCH_QUALITIES.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        )}
        {!small && sub.transport === 'tcp' && (
          <button className="icon-btn" title="Try the low-latency WebRTC transport again" onClick={() => sub.retry('webrtc')}>
            <Icon name="refresh" size={14} />
          </button>
        )}
        <TileButton focused={focused} onFocus={onFocus} />
        <button className="icon-btn" title={`Stop watching ${name}`} onClick={onStop}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <ScreenViewer
        stream={stream}
        placeholder={placeholder}
        overlay={overlay}
        audioAvailable={!!participant?.stream?.audio && state === 'streaming'}
        volumeKey={participant?.name}
        onViewHeight={(px) => sub.setViewHeight(px)}
      />
    </div>
  )
}

const WATCH_QUALITY_KEY = 'screenshare.watchQuality'

function loadWatchQuality(name: string | undefined): WatchQualityId {
  try {
    return getWatchQuality(localStorage.getItem(`${WATCH_QUALITY_KEY}:${name ?? ''}`)).id
  } catch {
    return 'auto' // storage unavailable
  }
}

function saveWatchQuality(name: string | undefined, id: WatchQualityId): void {
  try {
    localStorage.setItem(`${WATCH_QUALITY_KEY}:${name ?? ''}`, id)
  } catch {
    // storage unavailable
  }
}

function TileButton({ focused, onFocus }: { focused: boolean; onFocus(): void }) {
  return (
    <button className="icon-btn" title={focused ? 'Back to grid' : 'Focus this stream'} onClick={onFocus}>
      <Icon name={focused ? 'exitFullscreen' : 'fit'} size={14} />
    </button>
  )
}
