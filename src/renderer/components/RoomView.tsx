import { useCallback, useEffect, useRef, useState } from 'react'
import { QUALITY_PRESETS, WATCH_QUALITIES, getWatchQuality, lowerPreset, type WatchQualityId } from '../../shared/quality'
import { struggleMessage, type StruggleKind } from '../../shared/struggle'
import { bestTileGrid } from '../../shared/tileGrid'
import type {
  AudioChoice,
  ChatMessage,
  HostedRoom,
  HostStats,
  Participant,
  RoomState,
  Settings,
  ViewerStats
} from '../../shared/types'
import { newerVersionInRoom } from '../../shared/version'
import {
  captureAudioWarning,
  errorMessage,
  formatBitrate,
  latencyClass
} from '../lib/format'
import { useAppVersion } from '../lib/appVersion'
import { PANEL_STATES, useElementSize, useRemembered } from '../lib/layout'
import { useAutoContentHint } from '../lib/autoContentHint'
import { useGameCursor } from '../lib/gameCursor'
import { audioDefaults, type SharingState } from '../lib/publisher'
import type { ConnectionState } from '../lib/roomClient'
import type { Session } from '../lib/session'
import type { Subscription, SubscriptionState } from '../lib/subscription'
import { ChatPanel } from './ChatPanel'
import { ChangeSourceDialog } from './Dialogs'
import { Avatar } from './Avatar'
import { HostStatsPanel } from './HostControls'
import { Icon } from './Icon'
import { RoomInfo } from './RoomInfo'
import { InviteTile, PersonTile } from './RoomStage'
import { ScreenViewer } from './ScreenViewer'

interface Props {
  session: Session
  settings: Settings
  onLeave(reason?: string): void
  onChangeSettings(patch: Partial<Settings>): void
  onToast(message: string, tone?: 'error' | 'info'): void
}

/**
 * The room you're in: a tile per person in the middle (people sharing show
 * their stream's preview until you watch it), the control bar under it, and
 * the chat on the right. Nothing plays until you choose; focusing a tile puts
 * it in the spotlight while the others keep playing.
 */
export function RoomView({ session, settings, onLeave, onChangeSettings, onToast }: Props) {
  const { client, publisher, watches } = session
  const isHost = session.role === 'host'
  const [room, setRoom] = useState<RoomState | null>(client.room)
  const [participants, setParticipants] = useState<Participant[]>(client.participants)
  const [messages, setMessages] = useState<ChatMessage[]>(client.messages)
  const [connection, setConnection] = useState<ConnectionState>(client.state)
  const ourVersion = useAppVersion()
  /** A newer version someone runs that we already acknowledged (the notice comes back for an even newer one). */
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  /** The struggle notice on screen (the publisher rate-limits them). */
  const [struggle, setStruggle] = useState<StruggleKind | null>(null)
  const [ownStream, setOwnStream] = useState<MediaStream | null>(publisher.stream)
  const [ownSnapshot, setOwnSnapshot] = useState<string | null>(publisher.snapshot)
  // Your own stream isn't played back until you ask: rendering it costs GPU
  // time on the machine that is also capturing and encoding it.
  const [showSelf, setShowSelf] = useState(false)
  const [sharing, setSharing] = useState<SharingState>(publisher.state)
  const [ownStats, setOwnStats] = useState<HostStats | null>(null)
  const [subs, setSubs] = useState<ReadonlyMap<string, Subscription>>(new Map(watches.all))
  const [focus, setFocus] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, string>>(new Map(client.snapshots))
  const [avatars, setAvatars] = useState<ReadonlyMap<string, string>>(new Map(client.avatars))
  const [hosted, setHosted] = useState<HostedRoom | null>(session.hosted)
  const [showStats, setShowStats] = useState(false)
  const [pickSource, setPickSource] = useState(false)
  const [sidePanel, setSidePanel] = useRemembered('room-side', 'open', PANEL_STATES)
  const [infoOpen, setInfoOpen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const stageSize = useElementSize(stageRef)
  const closeInfo = useCallback(() => setInfoOpen(false), [])
  const [, setNow] = useState(Date.now())
  const gameCursor = useGameCursor(publisher, sharing.sharing ? publisher.chosenSourceId : null)
  useAutoContentHint(publisher, sharing.sharing ? publisher.chosenSourceId : null, settings.contentHint)
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
      publisher.on('stopped', (reason) => onToast(reason, 'info')),
      publisher.on('struggle', setStruggle),
      watches.on('changed', (m) => setSubs(new Map(m)))
    ]
    if (session.role === 'host') offs.push(window.api.host.onChanged((h) => h && setHosted(h)))
    return () => offs.forEach((o) => o())
  }, [session, publisher, watches, onToast])

  // A new share starts hidden again.
  useEffect(() => {
    if (!ownStream) setShowSelf(false)
  }, [ownStream])

  // Keep the focus on someone who is still here; Esc leaves it.
  useEffect(() => {
    if (focus !== null && !participants.some((p) => p.id === focus)) setFocus(null)
  }, [focus, participants])
  useEffect(() => {
    if (focus === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.fullscreenElement) setFocus(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus])

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

  // The room's name in the taskbar and alt-tab.
  const roomName = room?.name
  useEffect(() => {
    document.title = roomName ? `ScreenShare · ${roomName}` : 'ScreenShare'
    return () => {
      document.title = 'ScreenShare'
    }
  }, [roomName])

  // --- actions ---------------------------------------------------------------
  const shareSource = async (id: string, audio: AudioChoice): Promise<void> => {
    setPickSource(false)
    try {
      await publisher.startCapture(id, audio)
      const warning = captureAudioWarning(publisher, audio)
      if (warning) onToast(warning, 'error')
    } catch (err) {
      onToast(`Could not capture: ${errorMessage(err)}`, 'error')
    }
  }

  const endRoom = (): void => {
    if (!confirm('End the room for everyone?')) return
    onLeave()
  }

  const liveOthers = participants.filter((p) => p.stream && p.id !== client.selfId)
  const unwatched = liveOthers.filter((p) => !subs.has(p.id))
  const watcherCount = (id: string): number => participants.filter((p) => p.watching.includes(id)).length
  // The notice goes away by itself once the problem has gone (or sharing stopped).
  const struggleShown = struggle && sharing.sharing && ownStats?.struggling.includes(struggle) ? struggle : null
  const lower = lowerPreset(settings.maxQuality)
  const newer = ourVersion ? newerVersionInRoom(ourVersion, participants.filter((p) => p.id !== client.selfId)) : null

  // --- stage: a tile per person ------------------------------------------------
  // People sharing first, then everyone else in the order they came; you last.
  const people = [...participants].sort(
    (a, b) =>
      Number(a.id === client.selfId) - Number(b.id === client.selfId) ||
      Number(!!b.stream) - Number(!!a.stream) ||
      a.joinedAt - b.joinedAt
  )
  const alone = participants.length <= 1
  const inviteAddress = hosted
    ? hosted.addresses[0]
      ? `${hosted.addresses[0]}:${hosted.port}`
      : null
    : `${session.endpoint.address}:${session.endpoint.port}`

  const renderTile = (p: Participant, small: boolean) => {
    const focused = focus === p.id
    const onFocus = (): void => setFocus(focused ? null : p.id)
    if (p.id === client.selfId) {
      if (ownStream && showSelf) {
        return (
          <SelfTile
            key={p.id}
            stream={ownStream}
            sharing={sharing}
            stats={ownStats}
            showOverlay={settings.showStatsOverlay}
            focused={focused}
            small={small}
            onFocus={onFocus}
            onHide={() => setShowSelf(false)}
          />
        )
      }
      return (
        <PersonTile
          key={p.id}
          name={p.name}
          color={p.color}
          image={avatars.get(p.id) ?? settings.avatar}
          you
          reconnecting={false}
          live={
            ownStream
              ? {
                  snapshot: ownSnapshot,
                  paused: sharing.paused,
                  watchers: watcherCount(p.id),
                  action: 'Show my stream',
                  actionLabel: 'Show your own stream',
                  onAction: () => setShowSelf(true)
                }
              : null
          }
          focused={focused}
          small={small}
          onFocus={onFocus}
        />
      )
    }
    const sub = subs.get(p.id)
    if (sub) {
      return (
        <RemoteTile
          key={p.id}
          sub={sub}
          participant={p}
          avatar={avatars.get(p.id) ?? null}
          snapshot={snapshots.get(p.id) ?? null}
          showOverlay={settings.showStatsOverlay}
          focused={focused}
          small={small}
          onFocus={onFocus}
          onStop={() => watches.unwatch(p.id)}
        />
      )
    }
    return (
      <PersonTile
        key={p.id}
        name={p.name}
        color={p.color}
        image={avatars.get(p.id) ?? null}
        you={false}
        reconnecting={p.status === 'reconnecting'}
        live={
          p.stream
            ? {
                snapshot: snapshots.get(p.id) ?? null,
                paused: p.stream.paused,
                watchers: watcherCount(p.id),
                action: 'Watch stream',
                actionLabel: `Watch ${p.name}'s stream`,
                onAction: () => watches.watch(p.id)
              }
            : null
        }
        focused={focused}
        small={small}
        onFocus={onFocus}
      />
    )
  }

  const focused = focus ? people.find((p) => p.id === focus) : undefined
  // Tiles keep a 16:9 shape and grow as large as the stage allows (6 px padding and gaps).
  const grid = bestTileGrid(people.length + (alone ? 1 : 0), stageSize.width - 12, stageSize.height - 12)
  const stage =
    focused && people.length > 1 ? (
      <div className="stage-spotlight">
        <div className="spotlight-main">{renderTile(focused, false)}</div>
        <div className="spotlight-strip">{people.filter((p) => p !== focused).map((p) => renderTile(p, true))}</div>
      </div>
    ) : (
      <div
        className="stage-grid"
        style={{ gridTemplateColumns: `repeat(${grid.columns}, ${grid.width}px)`, gridAutoRows: `${grid.height}px` }}
      >
        {people.map((p) => renderTile(p, false))}
        {alone && (
          <InviteTile
            address={inviteAddress}
            onCopy={() =>
              inviteAddress &&
              void window.api.system.copyText(inviteAddress).then(() => onToast('Address copied to clipboard'))
            }
          />
        )}
      </div>
    )

  const liveCount = room?.streams ?? 0
  return (
    <div className="room">
      <header className="room-header">
        <div className="room-title">
          <h2 title={room?.name}>{room?.name ?? 'Room'}</h2>
          <button
            className={`icon-btn room-info-button ${infoOpen ? 'active' : ''}`}
            title="Room details"
            aria-label="Room details"
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((v) => !v)}
          >
            <Icon name="info" size={17} />
          </button>
          <span className="muted small room-count">
            {participants.length} {participants.length === 1 ? 'person' : 'people'}
            {liveCount > 0 && <span className="room-count-live"> · {liveCount} live</span>}
          </span>
          {connection === 'reconnecting' && <span className="status-pill warn">Reconnecting…</span>}
        </div>
        <button
          className={`icon-btn ${sidePanel === 'open' ? 'active' : ''}`}
          title={sidePanel === 'open' ? 'Hide chat' : 'Show chat'}
          aria-label={sidePanel === 'open' ? 'Hide chat' : 'Show chat'}
          aria-expanded={sidePanel === 'open'}
          onClick={() => setSidePanel(sidePanel === 'open' ? 'closed' : 'open')}
        >
          <Icon name="panelRight" size={18} />
        </button>
        {infoOpen && (
          <RoomInfo
            room={room}
            hosted={isHost ? hosted : null}
            endpoint={session.endpoint}
            rttMs={client.rttMs}
            onToast={onToast}
            onEndRoom={endRoom}
            onClose={closeInfo}
          />
        )}
      </header>

      <div className="room-body">
        <main className="stage">
          <div className="stage-area" ref={stageRef}>
            {stage}
          </div>
          {showStats && sharing.sharing && (
            <div className="stats-popover">
              <label className="stats-quality">
                <span className="muted small">Maximum quality you send</span>
                <select
                  aria-label="Maximum quality you send"
                  title="Each viewer may get less: smaller tile, their own choice, their network"
                  value={settings.maxQuality}
                  onChange={(e) => onChangeSettings({ maxQuality: e.target.value as Settings['maxQuality'] })}
                >
                  {QUALITY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <HostStatsPanel stats={ownStats} />
            </div>
          )}
          {gameCursor?.active && (
            <div className="notice info cursor-hint" role="status">
              <span className="cursor-hint-text">
                Sharing <strong>{gameCursor.active.name}</strong>&apos;s window while it hides your mouse cursor, so
                viewers don&apos;t see the cursor. Your screen comes back when you switch to another window.
              </span>
              <button className="btn small" onClick={() => gameCursor.keepScreen()}>
                Share the screen instead
              </button>
            </div>
          )}
          {struggleShown && (
            <div className="notice warn struggle-hint" role="status">
              <span className="struggle-hint-text">{struggleMessage(struggleShown, ownStats?.viewers ?? 0)}</span>
              {lower && (
                <button
                  className="btn small"
                  onClick={() => {
                    onChangeSettings({ maxQuality: lower.id })
                    setStruggle(null)
                  }}
                >
                  Lower to {lower.label}
                </button>
              )}
              <button className="btn small" onClick={() => setStruggle(null)}>
                OK
              </button>
            </div>
          )}
          {newer && newer.appVersion !== dismissedVersion && (
            <div className="notice info version-hint" role="status">
              <span className="version-hint-text">
                <strong>{newer.name}</strong> runs ScreenShare {newer.appVersion}, a newer version than yours ({ourVersion}).
                Update when you can.
              </span>
              <button className="btn small" onClick={() => setDismissedVersion(newer.appVersion)}>
                OK
              </button>
            </div>
          )}
          {gameCursor?.hint && (
            <div className="notice warn cursor-hint" role="status">
              <span className="cursor-hint-text">
                Viewers see a mouse cursor over <strong>{gameCursor.hint.name}</strong> even though the game hides it.
                Share its window instead: screen sharing on this version of Windows always draws the cursor.
              </span>
              <button
                className="btn small primary"
                onClick={() =>
                  gameCursor.hint &&
                  void shareSource(gameCursor.hint.windowId, publisher.audioChoice)
                }
              >
                <Icon name="swap" size={14} /> Share its window
              </button>
              <button className="icon-btn" title="Dismiss" aria-label="Dismiss" onClick={() => gameCursor.dismissHint()}>
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          <div className="control-bar">
            {sharing.sharing ? (
              <div className="control-group">
                <button
                  className="btn"
                  aria-label={sharing.paused ? 'Resume' : 'Pause'}
                  title={sharing.paused ? 'Resume your stream' : 'Pause your stream (and its audio)'}
                  onClick={() => publisher.setPaused(!sharing.paused)}
                >
                  <Icon name={sharing.paused ? 'play' : 'pause'} />
                  <span className="btn-label">{sharing.paused ? 'Resume' : 'Pause'}</span>
                </button>
                <button
                  className={`btn ${sharing.hasAudio && sharing.audioMuted ? 'active' : ''}`}
                  disabled={!sharing.hasAudio}
                  title={
                    !sharing.hasAudio
                      ? 'Audio is not being captured (enable it via Change source)'
                      : sharing.appAudioOnly
                        ? "Mute or unmute the shared app's sound viewers hear"
                        : sharing.discordExcluded
                          ? 'Mute or unmute the system audio viewers hear (Discord is left out)'
                          : 'Mute or unmute the system audio viewers hear'
                  }
                  aria-label={!sharing.hasAudio ? 'No audio' : sharing.audioMuted ? 'Unmute audio' : 'Mute audio'}
                  onClick={() => publisher.setAudioMuted(!sharing.audioMuted)}
                >
                  <Icon name={sharing.hasAudio && !sharing.audioMuted ? 'volume' : 'volumeOff'} />
                  <span className="btn-label">
                    {!sharing.hasAudio ? 'No audio' : sharing.audioMuted ? 'Unmute audio' : 'Mute audio'}
                  </span>
                </button>
                <button
                  className="btn"
                  aria-label="Change source"
                  title="Share another screen or window, or change the audio"
                  onClick={() => setPickSource(true)}
                >
                  <Icon name="swap" />
                  <span className="btn-label">Change source</span>
                </button>
                <button className="btn" aria-label="Stop sharing" title="Stop sharing" onClick={() => publisher.stopSharing()}>
                  <Icon name="stop" />
                  <span className="btn-label">Stop sharing</span>
                </button>
                <button
                  className={`btn icon-only ${showStats ? 'active' : ''}`}
                  title="Quality and stats of your stream"
                  aria-label="Stats"
                  aria-expanded={showStats}
                  onClick={() => setShowStats((v) => !v)}
                >
                  <Icon name="sliders" />
                </button>
              </div>
            ) : (
              <button className="btn primary" onClick={() => setPickSource(true)}>
                <Icon name="screen" /> Share screen
              </button>
            )}
            {unwatched.length > 1 && (
              <button
                className="btn"
                aria-label="Watch all"
                title="Watch everyone who is sharing"
                onClick={() => unwatched.forEach((p) => watches.watch(p.id))}
              >
                <Icon name="eye" />
                <span className="btn-label">Watch all</span>
              </button>
            )}
            <button
              className="btn hang-up"
              title={isHost ? 'End the room for everyone' : 'Leave the room'}
              aria-label={isHost ? 'End room' : 'Leave'}
              onClick={isHost ? endRoom : () => onLeave()}
            >
              <Icon name="hangUp" size={20} />
            </button>
          </div>
        </main>

        <aside className="sidebar" hidden={sidePanel === 'closed'}>
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
          current={publisher.chosenSourceId}
          currentAudio={publisher.sharing ? publisher.audioChoice : audioDefaults(settings)}
          onCancel={() => setPickSource(false)}
          onPick={(id, audio) => void shareSource(id, audio)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

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
        onHiddenChange={(hidden) => sub.setTileHidden(hidden)}
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
