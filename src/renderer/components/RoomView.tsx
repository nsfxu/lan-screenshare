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
import { usePlatform } from '../lib/appVersion'
import { askConfirm } from '../lib/confirm'
import { useT } from '../lib/i18n'
import { qualityLabel, watchQualityLabel } from '../lib/quality'
import { useIdleControls } from '../lib/idleControls'
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
  const { t, rich } = useT()
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
  const [menu, setMenu] = useState<{ at: MenuAt; items: MenuItem[]; label: string; sharing?: boolean } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  // Messages read while the chat was open; the rest count as unread while it's hidden.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(client.messages.map((m) => m.id)))
  const stageRef = useRef<HTMLDivElement>(null)
  const stageSize = useElementSize(stageRef)
  // Full screen is the stage: the focused stream with everyone else and its controls below.
  const [stageFullscreen, setStageFullscreen] = useState(false)
  /** The controls float over the stage and show while the mouse moves there (in full screen, so do the strip and the cursor). */
  const idleControls = useIdleControls(CONTROLS_IDLE_MS)
  /** Streams playing in a window of their own, by streamer id. */
  const [streamWindows, setStreamWindows] = useState<ReadonlyMap<string, { win: Window; root: HTMLElement }>>(new Map())
  const streamWindowsRef = useRef(streamWindows)
  streamWindowsRef.current = streamWindows
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
      // Leaving on purpose needs no message.
      client.on('closed', ({ reason, code }) => onLeave(code === 'left' ? undefined : reason))
    ]
    // Pictures, previews and chat lines (our own "joined") that arrived between
    // the first render and now (pictures are only sent once).
    setSnapshots(new Map(client.snapshots))
    setAvatars(new Map(client.avatars))
    setMessages(client.messages)
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
  // Going in or out of full screen shows the controls again for a moment.
  useEffect(() => idleControls.wake(), [stageFullscreen]) // eslint-disable-line react-hooks/exhaustive-deps
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
    const opened = openStreamWindow(p.id, t('room.streamWindowTitle', { name: p.name }))
    if (!opened) {
      onToast(t('room.windowFailed'), 'error')
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
    const timer = setInterval(() => {
      for (const [id, w] of streamWindowsRef.current) if (w.win.closed) closeStreamWindow(id)
    }, 1000)
    return () => clearInterval(timer)
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
      // Esc first closes whatever is open on top (a dialog, a menu); only then does it leave the focus view.
      if (e.key !== 'Escape' || document.fullscreenElement) return
      if (document.querySelector('.modal-backdrop, [role="menu"]')) return
      setFocus(null)
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
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
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
      onToast(t('room.captureFailed', { error: errorMessage(err) }), 'error')
    }
  }

  const endRoom = (): void => {
    void askConfirm({
      title: t('room.endTitle'),
      message: t('room.endMessage'),
      confirm: t('room.endConfirm'),
      danger: true
    }).then((ok) => ok && onLeave())
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
            ? { label: t('room.showEveryone'), icon: 'users', onSelect: toggleFilter }
            : { label: t('room.showOnlyStreams'), icon: 'filter', onSelect: toggleFilter }
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
    { label: t('room.changeSource'), icon: 'swap', onSelect: () => setPickSource(true) },
    {
      label: !sharing.hasAudio ? t('room.noAudio') : sharing.audioMuted ? t('room.unmuteAudio') : t('room.muteAudio'),
      icon: sharing.hasAudio && !sharing.audioMuted ? 'volumeOff' : 'volume',
      disabled: !sharing.hasAudio,
      onSelect: () => publisher.setAudioMuted(!sharing.audioMuted)
    },
    { kind: 'separator' },
    { kind: 'heading', label: t('room.qualityYouSend') },
    ...QUALITY_PRESETS.map(
      (q): MenuItem => ({
        label: qualityLabel(q),
        checked: settings.maxQuality === q.id,
        onSelect: () => onChangeSettings({ maxQuality: q.id })
      })
    ),
    { kind: 'separator' },
    {
      label: showStats ? t('room.hideStreamStats') : t('room.streamStats'),
      icon: 'chart',
      onSelect: () => setShowStats((v) => !v)
    },
    { kind: 'separator' },
    { label: t('room.stopSharing'), icon: 'stopShare', danger: true, onSelect: () => publisher.stopSharing() }
  ]

  const selfItems = (): MenuItem[] =>
    sharing.sharing
      ? [
          showSelf
            ? { label: t('room.hideMyStream'), icon: 'x', onSelect: () => setShowSelf(false) }
            : { label: t('room.showMyStream'), icon: 'screen', onSelect: () => setShowSelf(true) },
          { kind: 'separator' },
          ...sharingItems()
        ]
      : [{ label: t('room.shareScreenMenu'), icon: 'screen', onSelect: () => setPickSource(true) }]

  /** Someone else's tile: watching and focus. */
  const personItems = (p: Participant): MenuItem[] => {
    const items: MenuItem[] = []
    if (p.stream) {
      items.push(
        subs.has(p.id)
          ? { label: t('room.stopWatching'), icon: 'x', onSelect: () => watches.unwatch(p.id) }
          : { label: t('room.watchStream'), icon: 'eye', onSelect: () => watches.watch(p.id) }
      )
    }
    if (shown.length > 1) {
      items.push({
        label: focus === p.id ? t('room.backToGrid') : t('room.focus'),
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
        label: t('room.stopStreamOf', { name: p.name }),
        icon: 'stop',
        danger: true,
        onSelect: () =>
          void askConfirm({
            title: t('room.stopStreamTitle', { name: p.name }),
            confirm: t('room.stopStream'),
            danger: true
          }).then(
            (ok) => ok && client.send({ type: 'stop-stream', userId: p.id })
          )
      })
    }
    if (p.role === 'viewer') {
      items.push({
        label: t('room.removeFromRoom'),
        icon: 'kick',
        danger: true,
        onSelect: () =>
          void askConfirm({
            title: t('room.removeTitle', { name: p.name }),
            message: t('room.removeMessage'),
            confirm: t('common.remove'),
            danger: true
          }).then((ok) => ok && client.send({ type: 'kick', userId: p.id }))
      })
    }
    return items
  }

  const openMenu = (at: MenuAt, label: string, groups: MenuItem[][], sharingMenu = false): void => {
    const items = groups
      .filter((g) => g.length > 0)
      .flatMap((g, i): MenuItem[] => (i === 0 ? g : [{ kind: 'separator' }, ...g]))
    if (items.length > 0) setMenu({ at, items, label, sharing: sharingMenu })
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
    const onSelfMenu = rightClick(t('room.yourStream'), () => [selfItems(), filterItems()])
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
                  action: t('room.showMyStream'),
                  actionLabel: t('room.showYourStream'),
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
          onMenu={(at, groups) => openMenu(at, t('room.streamOf', { name: p.name }), groups)}
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
                action: t('room.watchStream'),
                actionLabel: t('room.watchStreamOf', { name: p.name }),
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
              void window.api.system.copyText(inviteAddress).then(() => onToast(t('common.addressCopied')))
            }
          />
        )}
      </div>
    )

  const roomDetails = (
    <div className="room-info-anchor">
      <button
        className={`bar-btn room-info-button ${infoOpen ? 'on' : ''}`}
        data-tip={t('room.details')}
        aria-label={t('room.details')}
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
  const sharingMenuOpen = !!menu?.sharing
  const controlsShown = idleControls.shown || infoOpen || showStats || sharingMenuOpen
  const controls = (
    <div className="stage-controls" {...idleControls.controls}>
      <div className="controls-side">
        {roomDetails}
        {focused && shown.length > 1 && (
          <>
            <button
              className="bar-btn"
              data-tip={t('room.gridTip')}
              aria-label={t('room.gridView')}
              onClick={() => setFocus(null)}
            >
              <Icon name="grid" size={20} stroke={2.3} />
            </button>
            <button
              className={`bar-btn ${strip === 'closed' ? 'on' : ''}`}
              aria-label={strip === 'open' ? t('room.hideOthers') : t('room.showOthers', { count: shown.length - 1 })}
              aria-pressed={strip === 'closed'}
              data-tip={strip === 'open' ? t('room.hideOthersTip') : t('room.showOthersTip')}
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
            className={`bar-btn sharing ${sharingMenuOpen ? 'on' : ''}`}
            data-tip={t('room.sharingTip')}
            aria-label={sharing.paused ? t('room.sharingPaused') : t('room.sharing')}
            aria-haspopup="menu"
            aria-expanded={sharingMenuOpen}
            onClick={(e) =>
              sharingMenuOpen
                ? setMenu(null)
                : openMenu(menuAbove(e.currentTarget), t('room.sharing'), [sharingItems()], true)
            }
          >
            <Icon name={sharing.paused ? 'pause' : 'shareScreen'} size={22} stroke={2.3} />
            <Icon name="chevronUp" size={14} stroke={2.3} />
          </button>
        ) : (
          <button className="bar-btn share" data-tip={t('room.shareTip')} onClick={() => setPickSource(true)}>
            <Icon name="shareScreen" size={22} stroke={2.3} /> {t('room.shareScreen')}
          </button>
        )}
        <button
          className="bar-btn hang-up"
          data-tip={isHost ? t('room.endRoomTip') : t('room.leaveTip')}
          aria-label={isHost ? t('room.endRoom') : t('room.leave')}
          onClick={isHost ? endRoom : () => onLeave()}
        >
          <Icon name="hangUp" size={24} stroke={2.3} />
        </button>
      </div>
      <div className="controls-side end">
        {focusedStream?.stream?.audio && <VolumeControl name={focusedStream.name} />}
        {focusedStream && (
          <button
            className={`bar-btn ${streamWindows.has(focusedStream.id) ? 'on' : ''}`}
            data-tip={streamWindows.has(focusedStream.id) ? t('room.bringBackTip') : t('room.openInWindow')}
            aria-label={streamWindows.has(focusedStream.id) ? t('room.backToThisWindow') : t('room.openInWindow')}
            onClick={() => toggleWindow(focusedStream)}
          >
            <Icon name={streamWindows.has(focusedStream.id) ? 'popIn' : 'popOut'} size={20} stroke={2.3} />
          </button>
        )}
        <button
          className="bar-btn"
          data-tip={stageFullscreen ? t('room.exitFullscreenTip') : t('room.fullscreen')}
          aria-label={stageFullscreen ? t('room.exitFullscreen') : t('room.fullscreen')}
          onClick={toggleStageFullscreen}
        >
          <Icon name={stageFullscreen ? 'exitFullscreen' : 'fullscreen'} size={20} stroke={2.3} />
        </button>
      </div>
    </div>
  )

  return (
    <div className="room">
      {/* Floating at the top right, just under the window's own buttons. */}
      <div className="room-corner">
        {connection === 'reconnecting' && <span className="status-pill warn">{t('common.reconnecting')}</span>}
        <button
          className={`bar-btn corner-btn chat-toggle ${chatOpen ? 'on' : ''}`}
          data-tip={
            chatOpen ? t('room.hideChat') : unread > 0 ? t('room.showChatNew', { count: unread }) : t('room.showChat')
          }
          aria-label={
            chatOpen ? t('room.hideChat') : unread > 0 ? t('room.showChatUnread', { count: unread }) : t('room.showChat')
          }
          aria-expanded={chatOpen}
          onClick={toggleChat}
        >
          <Icon name="chat" size={20} stroke={2.3} />
          {unread > 0 && <span className="unread-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </div>
      <div className="room-body">
        <main className="stage">
          <div
            className={`stage-area ${stageFullscreen ? 'fullscreen' : ''} ${controlsShown ? '' : 'idle'}`}
            ref={stageRef}
            {...idleControls.area}
          >
            {stage}
            {controls}
          </div>
          {showStats && sharing.sharing && (
            <div className="stats-popover">
              <label className="stats-quality">
                <span className="muted small">{t('room.maxQualityYouSend')}</span>
                <select
                  aria-label={t('room.maxQualityYouSend')}
                  title={t('room.maxQualityTip')}
                  value={settings.maxQuality}
                  onChange={(e) => onChangeSettings({ maxQuality: e.target.value as Settings['maxQuality'] })}
                >
                  {QUALITY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {qualityLabel(p)}
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
                {rich('room.gameCursorActive', { name: <strong>{gameCursor.active.name}</strong> })}
              </span>
              <button className="btn small" onClick={() => gameCursor.keepScreen()}>
                {t('room.shareScreenInstead')}
              </button>
            </div>
          )}
          {struggleShown && (
            <div className="notice warn struggle-hint" role="status">
              <span className="struggle-hint-text">{struggleMessage(struggleShown, ownStats?.viewers ?? 0, t)}</span>
              {lower && (
                <button
                  className="btn small"
                  onClick={() => {
                    onChangeSettings({ maxQuality: lower.id })
                    setStruggle(null)
                  }}
                >
                  {t('room.lowerTo', { quality: qualityLabel(lower) })}
                </button>
              )}
              <button className="btn small" onClick={() => setStruggle(null)}>
                {t('common.ok')}
              </button>
            </div>
          )}
          {newer && newer.appVersion !== dismissedVersion && (
            <div className="notice info version-hint" role="status">
              <span className="version-hint-text">
                {rich('room.newerVersion', {
                  name: <strong>{newer.name}</strong>,
                  version: newer.appVersion,
                  ours: ourVersion ?? ''
                })}
              </span>
              <button className="btn small" onClick={() => setDismissedVersion(newer.appVersion)}>
                {t('common.ok')}
              </button>
            </div>
          )}
          {gameCursor?.hint && (
            <div className="notice warn cursor-hint" role="status">
              <span className="cursor-hint-text">
                {rich('room.gameCursorHint', { name: <strong>{gameCursor.hint.name}</strong> })}
              </span>
              <button
                className="btn small primary"
                onClick={() =>
                  gameCursor.hint &&
                  void shareSource(gameCursor.hint.windowId, publisher.audioChoice)
                }
              >
                <Icon name="swap" size={14} /> {t('room.shareItsWindow')}
              </button>
              <button
                className="icon-btn"
                title={t('room.dismiss')}
                aria-label={t('room.dismiss')}
                onClick={() => gameCursor.dismissHint()}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
        </main>

        <aside className={`sidebar ${chatDocked ? '' : 'floating'}`} hidden={!chatOpen}>
          <ChatPanel
            messages={messages}
            roomName={room?.name ?? t('common.room')}
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
              <StreamWindow
                sub={sub}
                participant={p}
                avatar={avatars.get(id) ?? null}
                win={win}
                onBack={() => closeStreamWindow(id)}
              />,
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
  const { t } = useT()
  const clickToFocus = useClickToFocus(onFocus)
  const overlay =
    showOverlay && stats && !small ? (
      <div className="stat-badges">
        <span className="stat-badge">{t('common.fps', { value: Math.round(stats.fps) })}</span>
        <span className="stat-badge">{formatBitrate(stats.bitrateKbps)}</span>
        <span className="stat-badge">{t('common.watching', { count: stats.viewers })}</span>
        {sharing.hasAudio && (
          <span className={`stat-badge ${sharing.audioMuted ? 'muted-badge' : ''}`}>
            {sharing.audioMuted ? t('badge.audioMuted') : t('badge.audio', { kbps: stats.audioKbps ?? 0 })}
          </span>
        )}
        <span className={`stat-badge ${stats.cpuPercent < 20 ? 'good' : 'ok'}`}>
          {t('badge.cpu', { percent: Math.round(stats.cpuPercent) })}
        </span>
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
              <h3>{t('room.sharingPausedTitle')}</h3>
            </div>
          ) : null
        }
      />
      <div className="tile-bar">
        <span className="tile-name">
          <Icon name="screen" size={13} /> {t('room.yourScreen')}
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
  const { t } = useT()
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

  const name = participant?.name ?? t('common.someone')
  const level = useLevel(participant?.name ?? '')
  const muted = !!participant?.stream?.audio && isSilent(level)
  const paused = !!participant?.stream?.paused
  let placeholder = null
  if (paused) {
    placeholder = (
      <div className="placeholder-content paused">
        <Icon name="pause" size={28} />
        <h3>{t('room.pausedBy', { name })}</h3>
      </div>
    )
  } else if (state === 'negotiating' || !stream) {
    placeholder = (
      <>
        {snapshot && <div className="placeholder-bg" style={{ backgroundImage: `url(${snapshot})` }} />}
        <div className="placeholder-content">
          <div className="spinner" />
          <h3>{t('room.connectingTo', { name })}</h3>
        </div>
      </>
    )
  }

  const overlay =
    showOverlay && stats && state === 'streaming' && !small ? (
      <div className="stat-badges">
        <span className="stat-badge">{t('common.fps', { value: stats.fps })}</span>
        <span className={`stat-badge ${latencyClass(stats.latencyMs)}`} title={t('badge.latencyTip')}>
          {stats.latencyMs === null ? t('common.ms', { value: '–' }) : `~${t('common.ms', { value: stats.latencyMs })}`}
        </span>
        <span className="stat-badge">
          {stats.width}×{stats.height}
        </span>
        <span className="stat-badge">
          {stats.codec || '…'} · {stats.transport === 'tcp' ? 'TCP' : 'WebRTC'}
        </span>
        {!participant?.stream?.audio && <span className="stat-badge muted-badge">{t('badge.noAudio')}</span>}
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
                label: t('volume.of', { name }),
                icon: 'volume',
                value: isSilent(getLevel(key)) ? 0 : getLevel(key).volume,
                onChange: (v) => setVolume(key, v)
              },
              {
                label: isSilent(getLevel(key)) ? t('volume.unmute') : t('volume.mute'),
                icon: isSilent(getLevel(key)) ? 'volume' : 'volumeOff',
                onSelect: () => toggleMute(key)
              }
            ]
          : []
        const view: MenuItem[] = [
          ...menuItems,
          {
            label: fullscreen ? t('room.exitFullscreen') : t('room.fullscreen'),
            icon: fullscreen ? 'exitFullscreen' : 'fullscreen',
            onSelect: onFullscreen
          },
          {
            label: inWindow ? t('room.backToThisWindow') : t('room.openInWindow'),
            icon: inWindow ? 'popIn' : 'popOut',
            onSelect: onToggleWindow
          }
        ]
        const qualities: MenuItem[] = [
          { kind: 'heading', label: t('room.qualityYouReceive') },
          ...WATCH_QUALITIES.map(
            (q): MenuItem => ({
              label: watchQualityLabel(q),
              checked: quality === q.id,
              onSelect: () => chooseQuality(q.id)
            })
          )
        ]
        if (sub.transport === 'tcp') {
          qualities.push({ label: t('room.tryFaster'), icon: 'refresh', onSelect: () => sub.retry('webrtc') })
        }
        onMenu({ x: e.clientX, y: e.clientY }, [sound, view, qualities, moderation])
      }}
    >
      {inWindow ? (
        <div className="screen-viewer">
          <div className="screen-placeholder">
            <div className="placeholder-content">
              <Icon name="popOut" size={26} />
              <h3>{t('room.playingElsewhere')}</h3>
              {!small && (
                <button className="btn small" onClick={onToggleWindow}>
                  <Icon name="popIn" size={14} /> {t('room.bringBack')}
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
            <span className="tile-muted" title={t('room.mutedTip')} aria-label={t('room.muted')}>
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
  const { t } = useT()
  if (people.length === 0) return null
  const names = people.map((p) => (p.id === selfId ? t('common.you', { name: p.name }) : p.name)).join(', ')
  return (
    <span
      className="tile-watchers"
      title={t('room.watchingList', { names })}
      aria-label={t('room.watchingLabel', { count: people.length, names })}
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
 * A stream in a window of its own (rendered there with a portal): the app's
 * title bar, the picture with its name, and the same floating controls as the
 * room (volume, back to the room, full screen). It plays the subscription the
 * room already has, at the size of that window.
 */
function StreamWindow({
  sub,
  participant,
  avatar,
  win,
  onBack
}: {
  sub: Subscription
  participant: Participant | undefined
  avatar: string | null
  win: Window
  onBack(): void
}) {
  const platform = usePlatform()
  const { t } = useT()
  const [stream, setStream] = useState<MediaStream | null>(sub.stream)
  useEffect(() => {
    setStream(sub.stream)
    return sub.on('stream', setStream)
  }, [sub])
  // The window's title follows the language too.
  const title = t('room.streamWindowTitle', { name: participant?.name ?? t('common.someone') })
  useEffect(() => {
    win.document.title = title
  }, [win, title])
  const stageRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const idleControls = useIdleControls(CONTROLS_IDLE_MS)
  useEffect(() => {
    const doc = win.document
    const onChange = (): void => {
      setFullscreen(!!doc.fullscreenElement)
      idleControls.wake()
    }
    doc.addEventListener('fullscreenchange', onChange)
    return () => doc.removeEventListener('fullscreenchange', onChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win])
  const name = participant?.name ?? t('common.someone')
  const toggleFullscreen = (): void => {
    if (win.document.fullscreenElement) void win.document.exitFullscreen()
    else void stageRef.current?.requestFullscreen()
  }
  return (
    <div className="stream-window-layout">
      <header className={`title-bar ${platform === 'darwin' ? 'mac' : ''}`}>
        <span className="title-bar-mark" aria-hidden="true">
          <Icon name="screen" size={12} />
        </span>
        <span className="title-bar-name">ScreenShare</span>
        <span className="title-bar-room">· {t('room.streamOf', { name })}</span>
      </header>
      <div
        ref={stageRef}
        className={`stream-window-stage ${fullscreen ? 'fullscreen' : ''} ${idleControls.shown ? '' : 'idle'}`}
        {...idleControls.area}
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest('button, input')) toggleFullscreen()
        }}
      >
        <ScreenViewer
          stream={stream}
          volumeKey={participant?.name}
          onViewHeight={(px) => sub.setViewHeight(px)}
          placeholder={
            stream ? null : (
              <div className="placeholder-content">
                <div className="spinner" />
                <h3>{t('room.connectingTo', { name })}</h3>
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
        <div className="stage-controls" {...idleControls.controls}>
          <div className="controls-side" />
          <div className="controls-center" />
          <div className="controls-side end">
            {participant?.stream?.audio && <VolumeControl name={participant.name} />}
            <button className="bar-btn" data-tip={t('room.backToRoom')} aria-label={t('room.backToRoom')} onClick={onBack}>
              <Icon name="popIn" size={20} stroke={2.3} />
            </button>
            <button
              className="bar-btn"
              data-tip={fullscreen ? t('room.exitFullscreenTip') : t('room.fullscreen')}
              aria-label={fullscreen ? t('room.exitFullscreen') : t('room.fullscreen')}
              onClick={toggleFullscreen}
            >
              <Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} size={20} stroke={2.3} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The speaker in the controls under a focused stream: a click mutes, or
 * unmutes back to the last volume; pointing at it shows the volume slider.
 */
function VolumeControl({ name }: { name: string }) {
  const { t } = useT()
  const level = useLevel(name)
  const silent = isSilent(level)
  return (
    <div className="volume-control">
      <button
        className={`bar-btn ${silent ? 'off' : ''}`}
        aria-label={silent ? t('volume.unmuteName', { name }) : t('volume.muteName', { name })}
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
          aria-label={t('volume.of', { name })}
          onChange={(e) => setVolume(name, Number(e.target.value))}
        />
        <span>{silent ? 0 : Math.round(level.volume * 100)}%</span>
        <span className="volume-pop-hint">{silent ? t('volume.hintUnmute') : t('volume.hintMute')}</span>
      </div>
    </div>
  )
}
