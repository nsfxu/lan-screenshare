import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { QUALITY_PRESETS, WATCH_QUALITIES, getWatchQuality, lowerPreset, type WatchQualityId } from '../../shared/quality'
import { countUnread } from '../../shared/chat'
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
import { CHAT_DOCKED_MIN_WIDTH, PANEL_STATES, useElementSize, useRemembered, useWindowWidth } from '../lib/layout'
import { getLevel, isSilent, setVolume, toggleMute, useLevel } from '../lib/volume'
import { useAutoContentHint } from '../lib/autoContentHint'
import { useGameCursor } from '../lib/gameCursor'
import { openStreamWindow } from '../lib/streamWindow'
import { audioDefaults, type SharingState } from '../lib/publisher'
import type { ConnectionState } from '../lib/roomClient'
import type { Session } from '../lib/session'
import type { Subscription, SubscriptionState } from '../lib/subscription'
import { ChatPanel } from './ChatPanel'
import { ChangeSourceDialog } from './Dialogs'
import { Avatar } from './Avatar'
import { HostStatsPanel } from './HostControls'
import { Menu, menuAbove, type MenuAt, type MenuItem } from './Menu'
import { Icon } from './Icon'
import { RoomInfo } from './RoomInfo'
import { InviteTile, PersonTile, useClickToFocus } from './RoomStage'
import { ScreenViewer } from './ScreenViewer'

/** Who the stage shows: everyone, or only the people sharing (remembered). */
const STAGE_FILTERS = ['everyone', 'streams'] as const
type StageFilter = (typeof STAGE_FILTERS)[number]

/** How many viewers' pictures a stream's name bar shows next to the count. */
const WATCHER_FACES = 3

/** The controls over the stage hide after this long without the mouse moving there (in full screen, so do the strip and the cursor). */
const CONTROLS_IDLE_MS = 2500

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
  const focusRef = useRef(focus)
  focusRef.current = focus
  /** How many streams we watched at the last change: starting the first one focuses it. */
  const watchedCount = useRef(watches.all.size)
  const [stageFilter, setStageFilter] = useRemembered<StageFilter>('stage-filter', 'everyone', STAGE_FILTERS)
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, string>>(new Map(client.snapshots))
  const [avatars, setAvatars] = useState<ReadonlyMap<string, string>>(new Map(client.avatars))
  const [hosted, setHosted] = useState<HostedRoom | null>(session.hosted)
  const [showStats, setShowStats] = useState(false)
  const [pickSource, setPickSource] = useState(false)
  const [sidePanel, setSidePanel] = useRemembered('room-side', 'open', PANEL_STATES)
  // In a narrow window the chat doesn't take space from the tiles: it opens over them when asked.
  const chatDocked = useWindowWidth() >= CHAT_DOCKED_MIN_WIDTH
  const [chatFloating, setChatFloating] = useState(false)
  const chatOpen = chatDocked ? sidePanel === 'open' : chatFloating
  const toggleChat = (): void =>
    chatDocked ? setSidePanel(sidePanel === 'open' ? 'closed' : 'open') : setChatFloating((v) => !v)
  const [infoOpen, setInfoOpen] = useState(false)
  /** In focus view, the strip of everyone else can be put away; its streams then pause their video. */
  const [strip, setStrip] = useRemembered('focus-strip', 'open', PANEL_STATES)
  /** The open popup menu: the sharing menu, or a tile's right-click menu. */
  const [menu, setMenu] = useState<{ at: MenuAt; items: MenuItem[]; label: string } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  // Messages read while the chat was open; the rest count as unread while it's hidden.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(client.messages.map((m) => m.id)))
  const stageRef = useRef<HTMLDivElement>(null)
  const stageSize = useElementSize(stageRef)
  // Full screen is the stage: the focused stream with everyone else and its controls below.
  const [stageFullscreen, setStageFullscreen] = useState(false)
  /** The controls float over the stage and show while the mouse moves there (see wake). */
  const [controlsAwake, setControlsAwake] = useState(true)
  const controlsTimer = useRef<number | null>(null)
  /** Where the pointer last was: Chromium also sends mouse moves when the page changes under a still pointer. */
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const [controlsFocused, setControlsFocused] = useState(false)
  /** Streams playing in a window of their own, by streamer id. */
  const [streamWindows, setStreamWindows] = useState<ReadonlyMap<string, { win: Window; root: HTMLElement }>>(new Map())
  const streamWindowsRef = useRef(streamWindows)
  streamWindowsRef.current = streamWindows
  /** Where the chat button goes: the title bar's right end (see TitleBar). */
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setTitleSlot(document.getElementById('title-bar-actions')), [])
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
      watches.on('changed', (m) => {
        // Starting to watch a stream, with nothing else watched or focused, opens it focused.
        if (watchedCount.current === 0 && m.size === 1 && focusRef.current === null) {
          setFocus([...m.keys()][0])
        }
        watchedCount.current = m.size
        setSubs(new Map(m))
      })
    ]
    if (session.role === 'host') offs.push(window.api.host.onChanged((h) => h && setHosted(h)))
    return () => offs.forEach((o) => o())
  }, [session, publisher, watches, onToast])

  // A new share starts hidden again.
  useEffect(() => {
    if (!ownStream) setShowSelf(false)
  }, [ownStream])

  useEffect(() => {
    const onChange = (): void => setStageFullscreen(!!stageRef.current && document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  // The controls show while the mouse moves over the stage, and hide after a moment
  // without movement or when it leaves (in full screen, so do the strip and the cursor).
  const wake = (): void => {
    setControlsAwake(true)
    if (controlsTimer.current) clearTimeout(controlsTimer.current)
    controlsTimer.current = window.setTimeout(() => {
      // Still pointing at them: they stay until the mouse moves off.
      if (controlsRef.current?.matches(':hover')) wake()
      else setControlsAwake(false)
    }, CONTROLS_IDLE_MS)
  }
  const sleep = (): void => {
    if (controlsTimer.current) clearTimeout(controlsTimer.current)
    setControlsAwake(false)
  }
  useEffect(() => {
    wake()
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageFullscreen])
  /** Focus `id` and fill the screen with the stage, or leave full screen. */
  const toggleFullscreen = (id: string): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    setFocus(id)
    void stageRef.current?.requestFullscreen()
  }
  /** Fill the screen with the stage as it is (the grid, or the focused stream), or leave full screen. */
  const toggleStageFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stageRef.current?.requestFullscreen()
  }

  // --- streams in a window of their own ----------------------------------------
  const closeStreamWindow = (id: string): void => {
    streamWindowsRef.current.get(id)?.win.close()
    setStreamWindows((m) => {
      if (!m.has(id)) return m
      const next = new Map(m)
      next.delete(id)
      return next
    })
  }
  const openInWindow = (p: Participant): void => {
    const opened = openStreamWindow(p.id, `${p.name}'s stream · ScreenShare`)
    if (!opened) {
      onToast("Couldn't open a new window", 'error')
      return
    }
    opened.win.addEventListener('pagehide', () => closeStreamWindow(p.id))
    setStreamWindows((m) => new Map(m).set(p.id, opened))
  }
  const toggleWindow = (p: Participant): void =>
    streamWindows.has(p.id) ? closeStreamWindow(p.id) : openInWindow(p)
  // A stream in its own window can be seen whatever the room's window does; one we stop watching closes it.
  useEffect(() => {
    for (const [id, sub] of subs) sub.setDetached(streamWindows.has(id))
    for (const id of streamWindows.keys()) if (!subs.has(id)) closeStreamWindow(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subs, streamWindows])
  // Closing a window by hand (the system's ×) is noticed here too, in case pagehide didn't come.
  useEffect(() => {
    if (streamWindows.size === 0) return
    const t = setInterval(() => {
      for (const [id, w] of streamWindowsRef.current) if (w.win.closed) closeStreamWindow(id)
    }, 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamWindows.size])
  // Leaving the room closes them.
  useEffect(() => () => streamWindowsRef.current.forEach((w) => w.win.close()), [])

  // Keep the focus on someone who is still here; Esc leaves it (after leaving full screen).
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

  useEffect(() => {
    if (chatOpen) setSeen(new Set(messages.map((m) => m.id)))
  }, [chatOpen, messages])
  const unread = chatOpen ? 0 : countUnread(messages, seen, client.selfId)

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

  /** Who watches `id`'s stream. */
  const watchersOf = (id: string): Participant[] => participants.filter((p) => p.watching.includes(id))
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
  // "Show only streams" leaves out people who aren't sharing, unless nobody is (the stage is never empty).
  const anyoneSharing = people.some((p) => p.stream)
  const canFilter = anyoneSharing && people.some((p) => !p.stream)
  const shown = stageFilter === 'streams' && anyoneSharing ? people.filter((p) => p.stream) : people
  const toggleFilter = (): void => setStageFilter(stageFilter === 'streams' ? 'everyone' : 'streams')
  const filterItems = (): MenuItem[] =>
    canFilter
      ? [
          stageFilter === 'streams'
            ? { label: 'Show everyone', icon: 'users', onSelect: toggleFilter }
            : { label: 'Show only streams', icon: 'filter', onSelect: toggleFilter }
        ]
      : []
  const inviteAddress = hosted
    ? hosted.addresses[0]
      ? `${hosted.addresses[0]}:${hosted.port}`
      : null
    : `${session.endpoint.address}:${session.endpoint.port}`

  // --- menus -------------------------------------------------------------------
  /** Everything about our share: the Sharing button's menu, and our own tile's right-click. */
  const sharingItems = (): MenuItem[] => [
    { label: 'Change source…', icon: 'swap', onSelect: () => setPickSource(true) },
    {
      label: !sharing.hasAudio ? 'No audio' : sharing.audioMuted ? 'Unmute audio' : 'Mute audio',
      icon: sharing.hasAudio && !sharing.audioMuted ? 'volumeOff' : 'volume',
      disabled: !sharing.hasAudio,
      onSelect: () => publisher.setAudioMuted(!sharing.audioMuted)
    },
    { kind: 'separator' },
    { kind: 'heading', label: 'Quality you send' },
    ...QUALITY_PRESETS.map(
      (q): MenuItem => ({
        label: q.label,
        checked: settings.maxQuality === q.id,
        onSelect: () => onChangeSettings({ maxQuality: q.id })
      })
    ),
    { kind: 'separator' },
    {
      label: showStats ? 'Hide stream stats' : 'Stream stats',
      icon: 'chart',
      onSelect: () => setShowStats((v) => !v)
    },
    { kind: 'separator' },
    { label: 'Stop sharing', icon: 'stopShare', danger: true, onSelect: () => publisher.stopSharing() }
  ]

  const selfItems = (): MenuItem[] =>
    sharing.sharing
      ? [
          showSelf
            ? { label: 'Hide my stream', icon: 'x', onSelect: () => setShowSelf(false) }
            : { label: 'Show my stream', icon: 'screen', onSelect: () => setShowSelf(true) },
          { kind: 'separator' },
          ...sharingItems()
        ]
      : [{ label: 'Share screen…', icon: 'screen', onSelect: () => setPickSource(true) }]

  /** Someone else's tile: watching and focus. */
  const personItems = (p: Participant): MenuItem[] => {
    const items: MenuItem[] = []
    if (p.stream) {
      items.push(
        subs.has(p.id)
          ? { label: 'Stop watching', icon: 'x', onSelect: () => watches.unwatch(p.id) }
          : { label: 'Watch stream', icon: 'eye', onSelect: () => watches.watch(p.id) }
      )
    }
    if (shown.length > 1) {
      items.push({
        label: focus === p.id ? 'Back to grid' : 'Focus',
        icon: focus === p.id ? 'exitFullscreen' : 'fit',
        onSelect: () => setFocus(focus === p.id ? null : p.id)
      })
    }
    return [...items, ...filterItems()]
  }

  /** The host's actions on someone, at the end of their tile's menu. */
  const moderationItems = (p: Participant): MenuItem[] => {
    if (!isHost) return []
    const items: MenuItem[] = []
    if (p.stream) {
      items.push({
        label: `Stop ${p.name}'s stream`,
        icon: 'stop',
        danger: true,
        onSelect: () => confirm(`Stop ${p.name}'s stream?`) && client.send({ type: 'stop-stream', userId: p.id })
      })
    }
    if (p.role === 'viewer') {
      items.push({
        label: 'Remove from room',
        icon: 'kick',
        danger: true,
        onSelect: () => confirm(`Remove ${p.name} from the room?`) && client.send({ type: 'kick', userId: p.id })
      })
    }
    return items
  }

  const openMenu = (at: MenuAt, label: string, groups: MenuItem[][]): void => {
    const items = groups
      .filter((g) => g.length > 0)
      .flatMap((g, i): MenuItem[] => (i === 0 ? g : [{ kind: 'separator' }, ...g]))
    if (items.length > 0) setMenu({ at, items, label })
  }
  const rightClick =
    (label: string, groups: () => MenuItem[][]) =>
    (e: { preventDefault(): void; clientX: number; clientY: number }): void => {
      e.preventDefault()
      openMenu({ x: e.clientX, y: e.clientY }, label, groups())
    }

  const renderTile = (p: Participant, small: boolean, collapsed = false) => {
    const focused = focus === p.id
    const onFocus = (): void => setFocus(focused ? null : p.id)
    const onSelfMenu = rightClick('Your stream', () => [selfItems(), filterItems()])
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
            onFullscreen={() => toggleFullscreen(p.id)}
            onContextMenu={onSelfMenu}
            watchers={<Watchers people={watchersOf(p.id)} avatars={avatars} selfId={client.selfId} small={small} />}
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
                  watchers: watchersOf(p.id).length,
                  action: 'Show my stream',
                  actionLabel: 'Show your own stream',
                  onAction: () => setShowSelf(true)
                }
              : null
          }
          focused={focused}
          small={small}
          onFocus={onFocus}
          onContextMenu={onSelfMenu}
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
          onFullscreen={() => toggleFullscreen(p.id)}
          fullscreen={stageFullscreen}
          collapsed={collapsed}
          menuItems={personItems(p)}
          moderation={moderationItems(p)}
          onMenu={(at, groups) => openMenu(at, `${p.name}'s stream`, groups)}
          watchers={<Watchers people={watchersOf(p.id)} avatars={avatars} selfId={client.selfId} small={small} />}
          inWindow={streamWindows.has(p.id)}
          onToggleWindow={() => toggleWindow(p)}
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
                watchers: watchersOf(p.id).length,
                action: 'Watch stream',
                actionLabel: `Watch ${p.name}'s stream`,
                onAction: () => watches.watch(p.id)
              }
            : null
        }
        focused={focused}
        small={small}
        onFocus={onFocus}
        onContextMenu={rightClick(p.name, () => [personItems(p), moderationItems(p)])}
      />
    )
  }

  const focused = focus ? shown.find((p) => p.id === focus) : undefined
  // Tiles keep a 16:9 shape and grow as large as the stage allows (6 px padding and gaps).
  const grid = bestTileGrid(shown.length + (alone ? 1 : 0), stageSize.width - 12, stageSize.height - 12)
  const stage =
    focused && shown.length > 1 ? (
      <div className={`stage-spotlight ${strip === 'closed' ? 'strip-closed' : ''}`}>
        <div className="spotlight-main">{renderTile(focused, false)}</div>
        <div className="spotlight-strip" hidden={strip === 'closed'}>
          {shown.filter((p) => p !== focused).map((p) => renderTile(p, true, strip === 'closed'))}
        </div>
      </div>
    ) : (
      <div
        className="stage-grid"
        style={{ gridTemplateColumns: `repeat(${grid.columns}, ${grid.width}px)`, gridAutoRows: `${grid.height}px` }}
      >
        {shown.map((p) => renderTile(p, false))}
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

  const roomDetails = (
    <div className="room-info-anchor">
      <button
        className={`bar-btn room-info-button ${infoOpen ? 'on' : ''}`}
        data-tip="Room details"
        aria-label="Room details"
        aria-expanded={infoOpen}
        onClick={() => setInfoOpen((v) => !v)}
      >
        <Icon name="info" size={20} stroke={2.3} />
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
    </div>
  )

  // The focused stream you watch: the volume and "new window" act on it.
  const focusedStream = focused && subs.has(focused.id) ? focused : null
  const controlsShown = controlsAwake || controlsFocused || infoOpen || showStats || menu?.label === 'Sharing'
  const controls = (
    <div
      className="stage-controls"
      ref={controlsRef}
      onMouseEnter={wake}
      // Keyboard focus keeps them up; a button clicked with the mouse keeps focus too, and mustn't.
      onFocus={(e) => setControlsFocused(e.target.matches(':focus-visible'))}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setControlsFocused(false)
      }}
    >
      <div className="controls-side">
        {roomDetails}
        {focused && shown.length > 1 && (
          <>
            <button className="bar-btn" data-tip="Back to the grid (Esc)" aria-label="Grid view" onClick={() => setFocus(null)}>
              <Icon name="grid" size={20} stroke={2.3} />
            </button>
            <button
              className={`bar-btn ${strip === 'closed' ? 'on' : ''}`}
              aria-label={strip === 'open' ? 'Hide others' : `Show others (${shown.length - 1})`}
              aria-pressed={strip === 'closed'}
              data-tip={strip === 'open' ? 'Hide the others (their video pauses)' : 'Show the others'}
              onClick={() => setStrip(strip === 'open' ? 'closed' : 'open')}
            >
              <Icon name={strip === 'open' ? 'stripHide' : 'stripShow'} size={20} stroke={2.3} />
            </button>
          </>
        )}
      </div>
      <div className="controls-center">
        {sharing.sharing ? (
          // Shows that we're sharing; its menu changes the source, mutes, sets the quality, shows the stats or stops.
          <button
            className={`bar-btn sharing ${menu?.label === 'Sharing' ? 'on' : ''}`}
            data-tip="Sharing: source, audio, quality, stats, stop"
            aria-label={sharing.paused ? 'Sharing (paused)' : 'Sharing'}
            aria-haspopup="menu"
            aria-expanded={menu?.label === 'Sharing'}
            onClick={(e) =>
              menu?.label === 'Sharing' ? setMenu(null) : openMenu(menuAbove(e.currentTarget), 'Sharing', [sharingItems()])
            }
          >
            <Icon name={sharing.paused ? 'pause' : 'shareScreen'} size={20} stroke={2.3} />
            <Icon name="chevronUp" size={14} stroke={2.3} />
          </button>
        ) : (
          <button className="bar-btn share" data-tip="Share your screen or a window" onClick={() => setPickSource(true)}>
            <Icon name="shareScreen" size={20} stroke={2.3} /> Share screen
          </button>
        )}
        <button
          className="bar-btn hang-up"
          data-tip={isHost ? 'End the room for everyone' : 'Leave the room'}
          aria-label={isHost ? 'End room' : 'Leave'}
          onClick={isHost ? endRoom : () => onLeave()}
        >
          <Icon name="hangUp" size={22} stroke={2.3} />
        </button>
      </div>
      <div className="controls-side end">
        {focusedStream?.stream?.audio && <VolumeControl name={focusedStream.name} />}
        {focusedStream && (
          <button
            className={`bar-btn ${streamWindows.has(focusedStream.id) ? 'on' : ''}`}
            data-tip={streamWindows.has(focusedStream.id) ? 'Bring it back to this window' : 'Open in a new window'}
            aria-label={streamWindows.has(focusedStream.id) ? 'Back to this window' : 'Open in a new window'}
            onClick={() => toggleWindow(focusedStream)}
          >
            <Icon name={streamWindows.has(focusedStream.id) ? 'popIn' : 'popOut'} size={20} stroke={2.3} />
          </button>
        )}
        <button
          className="bar-btn"
          data-tip={stageFullscreen ? 'Leave full screen (Esc)' : 'Full screen'}
          aria-label={stageFullscreen ? 'Exit full screen' : 'Full screen'}
          onClick={toggleStageFullscreen}
        >
          <Icon name={stageFullscreen ? 'exitFullscreen' : 'fullscreen'} size={20} stroke={2.3} />
        </button>
      </div>
    </div>
  )

  return (
    <div className="room">
      {titleSlot &&
        createPortal(
          <>
            {connection === 'reconnecting' && <span className="status-pill warn">Reconnecting…</span>}
            <button
              className={`title-bar-btn chat-toggle ${chatOpen ? 'on' : ''}`}
              data-tip={chatOpen ? 'Hide chat' : unread > 0 ? `Show chat (${unread} new)` : 'Show chat'}
              aria-label={chatOpen ? 'Hide chat' : unread > 0 ? `Show chat (${unread} unread)` : 'Show chat'}
              aria-expanded={chatOpen}
              onClick={toggleChat}
            >
              <Icon name="chat" size={16} />
              {unread > 0 && <span className="unread-badge">{unread > 99 ? '99+' : unread}</span>}
            </button>
          </>,
          titleSlot
        )}
      <div className="room-body">
        <main className="stage">
          <div
            className={`stage-area ${stageFullscreen ? 'fullscreen' : ''} ${controlsShown ? '' : 'idle'}`}
            ref={stageRef}
            onMouseMove={(e) => {
              const last = lastPointer.current
              if (last && last.x === e.screenX && last.y === e.screenY) return
              lastPointer.current = { x: e.screenX, y: e.screenY }
              wake()
            }}
            onMouseLeave={sleep}
          >
            {stage}
            {controls}
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
        </main>

        <aside className={`sidebar ${chatDocked ? '' : 'floating'}`} hidden={!chatOpen}>
          <ChatPanel
            messages={messages}
            roomName={room?.name ?? 'the room'}
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

      {menu && <Menu items={menu.items} at={menu.at} label={menu.label} onClose={closeMenu} />}

      {[...streamWindows].map(([id, { win, root }]) => {
        const sub = subs.get(id)
        const p = participants.find((x) => x.id === id)
        return sub
          ? createPortal(
              <StreamWindow sub={sub} participant={p} avatar={avatars.get(id) ?? null} win={win} />,
              root,
              id
            )
          : null
      })}

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
  onContextMenu?(e: ReactMouseEvent): void
  focused: boolean
  small: boolean
  showOverlay: boolean
  onFocus(): void
  /** Double-click: focus this tile and fill the screen with the stage. */
  onFullscreen(): void
  /** Who watches this stream, at the right of its name bar. */
  watchers: ReactNode
}

/** A tile's own double-click: full screen (a single click focuses, see useClickToFocus). */
function onDoubleClickOf(onFullscreen: () => void) {
  return (e: ReactMouseEvent): void => {
    if ((e.target as Element).closest('button, input, select, a')) return
    onFullscreen()
  }
}

function SelfTile({
  stream,
  sharing,
  stats,
  showOverlay,
  focused,
  small,
  onFocus,
  onFullscreen,
  onContextMenu,
  watchers
}: TileChrome & { stream: MediaStream | null; sharing: SharingState; stats: HostStats | null }) {
  const clickToFocus = useClickToFocus(onFocus)
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
    <div
      className={`tile stream-tile ${focused ? 'focused' : ''} ${small ? 'small' : ''}`}
      onClick={clickToFocus}
      onDoubleClick={onDoubleClickOf(onFullscreen)}
      onContextMenu={onContextMenu}
    >
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
      <div className="tile-bar">
        <span className="tile-name">
          <Icon name="screen" size={13} /> Your screen
        </span>
        {watchers}
      </div>
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
  onFullscreen,
  fullscreen,
  avatar,
  snapshot,
  collapsed,
  menuItems,
  moderation,
  onMenu,
  watchers,
  inWindow,
  onToggleWindow
}: TileChrome & {
  /** Playing in its own window: the tile says so instead of playing it too. */
  inWindow: boolean
  onToggleWindow(): void
  sub: Subscription
  participant: Participant | undefined
  avatar: string | null
  snapshot: string | null
  /** The stage is full screen (the menu then offers to leave it). */
  fullscreen: boolean
  /** In the put-away strip of the focus view: not visible, so the streamer pauses our video. */
  collapsed: boolean
  /** The start of the right-click menu (stop watching, focus) and the host's actions at its end. */
  menuItems: MenuItem[]
  moderation: MenuItem[]
  onMenu(at: MenuAt, groups: MenuItem[][]): void
}) {
  const clickToFocus = useClickToFocus(onFocus)
  // Hidden behind something else full screen, or put away with the strip.
  const [behindFullscreen, setBehindFullscreen] = useState(false)
  useEffect(() => sub.setTileHidden(behindFullscreen || collapsed), [sub, behindFullscreen, collapsed])
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
  const chooseQuality = (id: WatchQualityId): void => {
    setQuality(id)
    saveWatchQuality(participant?.name, id)
  }

  const name = participant?.name ?? 'Someone'
  const level = useLevel(participant?.name ?? '')
  const muted = !!participant?.stream?.audio && isSilent(level)
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
    <div
      className={`tile stream-tile ${focused ? 'focused' : ''} ${small ? 'small' : ''}`}
      onClick={clickToFocus}
      onDoubleClick={onDoubleClickOf(onFullscreen)}
      onContextMenu={(e) => {
        e.preventDefault()
        const key = participant?.name ?? ''
        const sound: MenuItem[] = participant?.stream?.audio
          ? [
              {
                kind: 'slider',
                label: `Volume of ${name}`,
                icon: 'volume',
                value: isSilent(getLevel(key)) ? 0 : getLevel(key).volume,
                onChange: (v) => setVolume(key, v)
              },
              {
                label: isSilent(getLevel(key)) ? 'Unmute' : 'Mute',
                icon: isSilent(getLevel(key)) ? 'volume' : 'volumeOff',
                onSelect: () => toggleMute(key)
              }
            ]
          : []
        const view: MenuItem[] = [
          ...menuItems,
          {
            label: fullscreen ? 'Exit full screen' : 'Full screen',
            icon: fullscreen ? 'exitFullscreen' : 'fullscreen',
            onSelect: onFullscreen
          },
          {
            label: inWindow ? 'Back to this window' : 'Open in a new window',
            icon: inWindow ? 'popIn' : 'popOut',
            onSelect: onToggleWindow
          }
        ]
        const qualities: MenuItem[] = [
          { kind: 'heading', label: 'Quality you receive' },
          ...WATCH_QUALITIES.map(
            (q): MenuItem => ({
              label: q.label,
              checked: quality === q.id,
              onSelect: () => chooseQuality(q.id)
            })
          )
        ]
        if (sub.transport === 'tcp') {
          qualities.push({ label: 'Try the faster connection again', icon: 'refresh', onSelect: () => sub.retry('webrtc') })
        }
        onMenu({ x: e.clientX, y: e.clientY }, [sound, view, qualities, moderation])
      }}
    >
      {inWindow ? (
        <div className="screen-viewer">
          <div className="screen-placeholder">
            <div className="placeholder-content">
              <Icon name="popOut" size={26} />
              <h3>Playing in another window</h3>
              {!small && (
                <button className="btn small" onClick={onToggleWindow}>
                  <Icon name="popIn" size={14} /> Bring back
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <ScreenViewer
          stream={stream}
          placeholder={placeholder}
          overlay={overlay}
          volumeKey={participant?.name}
          onViewHeight={(px) => sub.setViewHeight(px)}
          onHiddenChange={setBehindFullscreen}
        />
      )}
      <div className="tile-bar">
        <span className="tile-name">
          <Avatar name={name} color={participant?.color} image={avatar} size="tiny" />
          {name}
          {muted && (
            <span className="tile-muted" title="You muted this stream" aria-label="Muted">
              <Icon name="volumeOff" size={13} />
            </span>
          )}
        </span>
        {watchers}
      </div>
    </div>
  )
}

/**
 * Who is watching a stream: an eye with the count and the first few viewers'
 * pictures (only the count on a small tile); pointing at it lists them all.
 */
function Watchers({
  people,
  avatars,
  selfId,
  small
}: {
  people: Participant[]
  avatars: ReadonlyMap<string, string>
  selfId: string | null
  small: boolean
}) {
  if (people.length === 0) return null
  const names = people.map((p) => (p.id === selfId ? `${p.name} (you)` : p.name))
  return (
    <span
      className="tile-watchers"
      title={`Watching: ${names.join(', ')}`}
      aria-label={`${people.length} watching: ${names.join(', ')}`}
    >
      <Icon name="eye" size={13} />
      {people.length}
      {!small && (
        <span className="tile-watchers-faces">
          {people.slice(0, WATCHER_FACES).map((p) => (
            <Avatar key={p.id} name={p.name} color={p.color} image={avatars.get(p.id) ?? null} size="tiny" />
          ))}
        </span>
      )}
    </span>
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

/**
 * A stream in a window of its own (rendered there with a portal): the picture,
 * its name, double-click for full screen. It plays the subscription the room
 * already has, at the size of that window.
 */
function StreamWindow({
  sub,
  participant,
  avatar,
  win
}: {
  sub: Subscription
  participant: Participant | undefined
  avatar: string | null
  win: Window
}) {
  const [stream, setStream] = useState<MediaStream | null>(sub.stream)
  useEffect(() => {
    setStream(sub.stream)
    return sub.on('stream', setStream)
  }, [sub])
  const name = participant?.name ?? 'Someone'
  const toggleFullscreen = (): void => {
    const doc = win.document
    if (doc.fullscreenElement) void doc.exitFullscreen()
    else void doc.documentElement.requestFullscreen()
  }
  return (
    <div className="stream-window-view" onDoubleClick={toggleFullscreen} title="Double-click for full screen">
      <ScreenViewer
        stream={stream}
        volumeKey={participant?.name}
        onViewHeight={(px) => sub.setViewHeight(px)}
        placeholder={
          stream ? null : (
            <div className="placeholder-content">
              <div className="spinner" />
              <h3>Connecting to {name}…</h3>
            </div>
          )
        }
      />
      <div className="tile-bar">
        <span className="tile-name">
          <Avatar name={name} color={participant?.color} image={avatar} size="tiny" />
          {name}
        </span>
      </div>
    </div>
  )
}

/**
 * The speaker in the controls under a focused stream: a click mutes, or
 * unmutes back to the last volume; pointing at it shows the volume slider.
 */
function VolumeControl({ name }: { name: string }) {
  const level = useLevel(name)
  const silent = isSilent(level)
  return (
    <div className="volume-control">
      <button
        className={`bar-btn ${silent ? 'off' : ''}`}
        aria-label={silent ? `Unmute ${name}` : `Mute ${name}`}
        onClick={() => toggleMute(name)}
      >
        <Icon name={silent ? 'volumeOff' : 'volume'} size={20} stroke={2.3} />
      </button>
      <div className="volume-pop">
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={silent ? 0 : level.volume}
          aria-label={`Volume of ${name}`}
          onChange={(e) => setVolume(name, Number(e.target.value))}
        />
        <span>{silent ? 0 : Math.round(level.volume * 100)}%</span>
        <span className="volume-pop-hint">Click the speaker to {silent ? 'unmute' : 'mute'}</span>
      </div>
    </div>
  )
}
