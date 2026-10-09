import { useCallback, useEffect, useRef, useState } from 'react'
import { pushRecentRoom, sameEndpoint } from '../shared/roomList'
import type { CodecSupport, DiscoveredRoom, RoomEndpoint, RoomState, Settings } from '../shared/types'
import { ConfirmDialog, CreateRoomDialog, SettingsPanel, type CreateRoomResult } from './components/Dialogs'
import { askConfirm } from './lib/confirm'
import { RoomMembers } from './components/RoomMembers'
import { RoomsSidebar, type CurrentRoom } from './components/RoomsSidebar'
import { RoomView } from './components/RoomView'
import { TitleBar } from './components/TitleBar'
import { Welcome } from './components/Welcome'
import { detectDecoders, detectEncoders } from './lib/codecs'
import { captureAudioWarning, errorMessage } from './lib/format'
import { PANEL_STATES, ROOMS_DOCKED_MIN_WIDTH, useRemembered, useWindowWidth } from './lib/layout'
import { applyLanguage, setSystemLanguages, translator, useT } from './lib/i18n'
import { applyTheme } from './lib/theme'
import { audioDefaults } from './lib/publisher'
import { disposeSession, hostRoom, joinRoom, JoinError, updateSessionSettings, type Session } from './lib/session'

interface Toast {
  id: number
  message: string
  tone: 'error' | 'info'
}

interface PinPrompt {
  room: DiscoveredRoom
  error: string | null
  lockedUntil: number | null
}

export function App() {
  const { t } = useT()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [rooms, setRooms] = useState<DiscoveredRoom[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [codecs, setCodecs] = useState<{ encoders: CodecSupport[]; decoders: CodecSupport[] }>({ encoders: [], decoders: [] })
  const [creating, setCreating] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pinPrompt, setPinPrompt] = useState<PinPrompt | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [sidebar, setSidebar] = useRemembered('rooms', 'open', PANEL_STATES)
  // In a narrow window the rooms column is a strip; opening it shows it over the room for a moment.
  const roomsDocked = useWindowWidth() >= ROOMS_DOCKED_MIN_WIDTH
  const [roomsFloating, setRoomsFloating] = useState(false)
  const current = useCurrentRoom(session)
  // Joining or leaving a room puts a floating rooms column away.
  useEffect(() => setRoomsFloating(false), [session])
  const sessionRef = useRef<Session | null>(null)
  sessionRef.current = session
  const settingsRef = useRef<Settings | null>(null)
  settingsRef.current = settings

  const toast = useCallback((message: string, tone: 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((list) => [...list.slice(-3), { id, message, tone }])
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), tone === 'error' ? Math.max(6000, message.length * 60) : 3000)
  }, [])

  // --- startup -----------------------------------------------------------------
  useEffect(() => {
    // The language first, so the app opens in it.
    void Promise.all([window.api.settings.get(), window.api.system.info()]).then(([s, info]) => {
      setSystemLanguages(Array.isArray(info.languages) ? info.languages : [])
      applyLanguage(s.language)
      setSettings(s)
    })
    void window.api.rooms.list().then(setRooms)
    void Promise.all([detectEncoders(), detectDecoders()]).then(([encoders, decoders]) => {
      setCodecs({ encoders, decoders })
      window.api.system.log('info', `codecs enc=${JSON.stringify(encoders)} dec=${JSON.stringify(decoders)}`)
    })
    return window.api.rooms.onChanged(setRooms)
  }, [])

  const theme = settings?.theme
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await window.api.settings.update(patch)
    if ('language' in patch) applyLanguage(next.language)
    setSettings(next)
    if (sessionRef.current) updateSessionSettings(sessionRef.current, next)
  }, [])

  // --- joining -------------------------------------------------------------------
  const join = useCallback(
    async (room: DiscoveredRoom, pin?: string) => {
      if (!settings) return
      setBusyKey(room.key)
      try {
        // Fresh probe: confirms reachability, current privacy, and trusts the cert.
        const fresh = await window.api.rooms.resolve(room.address, room.port, room.tls)
        if (fresh.privacy === 'private' && !pin) {
          setPinPrompt({ room: fresh, error: null, lockedUntil: null })
          return
        }
        const endpoint: RoomEndpoint = { address: fresh.address, port: fresh.port, tls: fresh.tls, name: fresh.name }
        const s = await joinRoom(endpoint, settings, codecs, pin)
        setPinPrompt(null)
        setSession(s)
        void updateSettings({ lastRoom: endpoint, recentRooms: pushRecentRoom(settingsRef.current?.recentRooms ?? [], endpoint) })
      } catch (err) {
        if (err instanceof JoinError) {
          const d = err.detail
          if (d.code === 'pin_required' || d.code === 'bad_pin' || d.code === 'locked') {
            setPinPrompt({
              room,
              error:
                d.code === 'bad_pin'
                  ? [t('app.wrongPin'), d.attemptsLeft !== undefined ? t('app.attemptsLeft', { count: d.attemptsLeft }) : '']
                      .filter(Boolean)
                      .join(' ')
                  : null,
              lockedUntil: d.code === 'locked' ? Date.now() + (d.retryAfterMs ?? 0) : null
            })
            return
          }
          setPinPrompt(null)
          toast(d.message, 'error')
        } else {
          setPinPrompt(null)
          toast(t('app.couldNotJoin', { error: errorMessage(err) }), 'error')
        }
      } finally {
        setBusyKey(null)
      }
    },
    [settings, codecs, toast, updateSettings, t]
  )

  // Optional auto-rejoin of the last room on startup.
  const autoRejoinTried = useRef(false)
  useEffect(() => {
    if (!settings || autoRejoinTried.current) return
    autoRejoinTried.current = true
    const last = settings.lastRoom
    if (!settings.autoRejoin || !last) return
    window.api.rooms
      .resolve(last.address, last.port, last.tls)
      .then((room) => {
        if (!sessionRef.current) void join(room)
      })
      .catch(() => toast(t('app.lastRoomUnavailable', { name: last.name ?? last.address }), 'info'))
  }, [settings, join, toast, t])

  const leave = useCallback(
    (reason?: string) => {
      const s = sessionRef.current
      if (!s) return
      sessionRef.current = null
      setSession(null)
      disposeSession(s)
      if (s.role === 'host') void window.api.host.close()
      if (reason) toast(reason, s.role === 'host' ? 'info' : 'error')
    },
    [toast]
  )

  /** Before going to another room: leave this one, asking first when that ends the room or a share. */
  const leaveForAnother = async (): Promise<boolean> => {
    const s = sessionRef.current
    if (!s) return true
    const name = s.client.room?.name ?? t('common.room')
    if (s.role === 'host') {
      const ok = await askConfirm({
        title: t('app.endToSwitchTitle', { name }),
        message: t('app.endToSwitchMessage', { name }),
        confirm: t('app.endToSwitchConfirm'),
        danger: true
      })
      if (!ok) return false
    } else if (s.publisher.sharing) {
      const ok = await askConfirm({
        title: t('app.leaveTitle', { name }),
        message: t('app.leaveSharingMessage'),
        confirm: t('app.leave'),
        danger: true
      })
      if (!ok) return false
    }
    // The answer may come after the session already ended by itself.
    if (sessionRef.current === s) leave()
    return true
  }

  const switchTo = async (room: DiscoveredRoom): Promise<void> => {
    if (busyKey || (current?.endpoint && sameEndpoint(current.endpoint, room))) return
    if (await leaveForAnother()) void join(room)
  }

  /** A remembered room that isn't in the list: ask it directly, it may be on a VPN. */
  const switchToEndpoint = async (ep: RoomEndpoint): Promise<void> => {
    if (busyKey || (current?.endpoint && sameEndpoint(current.endpoint, ep))) return
    if (!(await leaveForAnother())) return
    const key = `${ep.address}:${ep.port}`
    setBusyKey(key)
    try {
      const room = await window.api.rooms.resolve(ep.address, ep.port, ep.tls)
      setBusyKey(null)
      await join(room)
    } catch (err) {
      setBusyKey(null)
      toast(t('app.notAvailable', { name: ep.name ?? key, error: errorMessage(err) }), 'error')
    }
  }

  // --- hosting ---------------------------------------------------------------------
  const create = async (req: CreateRoomResult): Promise<void> => {
    if (!settings || !(await leaveForAnother())) return
    setCreateBusy(true)
    setCreateError(null)
    let hostedCreated = false
    try {
      const hosted = await window.api.host.create({ name: req.name, privacy: req.privacy, pinLength: req.pinLength })
      hostedCreated = true
      const s = await hostRoom(hosted, settings, codecs)
      try {
        await s.publisher.startCapture(req.sourceId, req.audio)
        const warning = captureAudioWarning(s.publisher, req.audio)
        if (warning) toast(warning, 'error')
      } catch (err) {
        toast(t('app.captureFailedAfterCreate', { error: errorMessage(err) }), 'error')
      }
      setSession(s)
      setCreating(false)
      if (hosted.pin) {
        void window.api.system.copyText(hosted.pin)
        toast(t('app.pinCopied', { pin: hosted.pin }))
      }
    } catch (err) {
      setCreateError(errorMessage(err))
      if (hostedCreated) void window.api.host.close()
    } finally {
      setCreateBusy(false)
    }
  }

  // Closing the window while hosting: asked here, in the app's dialog (the main process waits for the answer).
  useEffect(
    () =>
      window.api.system.onConfirmClose(() => {
        const name = sessionRef.current?.client.room?.name ?? t('common.room')
        void askConfirm({
          title: t('app.quitTitle'),
          message: t('app.quitMessage', { name }),
          confirm: t('app.quitConfirm'),
          danger: true
        }).then((ok) => {
          if (ok) void window.api.system.closeConfirmed()
        })
      }),
    []
  )

  if (!settings) return <div className="boot">{t('common.loading')}</div>

  const roomsFloatingNow = !roomsDocked && (roomsFloating || !!pinPrompt)

  const openCreate = (): void => {
    setCreateError(null)
    setCreating(true)
  }

  /** Restarts into a downloaded update, after asking when that would end or leave a room. */
  const restartToUpdate = async (): Promise<void> => {
    const s = sessionRef.current
    if (s) {
      const name = s.client.room?.name ?? t('common.room')
      const ok = await askConfirm({
        title: t('app.restartTitle'),
        message: s.role === 'host' ? t('app.restartEndsRoom', { name }) : t('app.restartLeavesRoom', { name }),
        confirm: t('app.restartNow'),
        danger: s.role === 'host'
      })
      if (!ok) return
    }
    void window.api.update.install()
  }


  return (
    <>
      <TitleBar roomName={current?.name ?? null} onRestartToUpdate={restartToUpdate} />
      <div className="shell">
        {roomsFloatingNow && (
          <>
            <div className="rooms-sidebar-space" />
            <div
              className="overlay-backdrop"
              onClick={() => {
                setRoomsFloating(false)
                setPinPrompt(null)
              }}
            />
          </>
        )}
        <RoomsSidebar
          floating={roomsFloatingNow}
          settings={settings}
          rooms={rooms}
          current={current}
          members={session && <RoomMembers key={session.client.url} session={session} />}
          pin={
            pinPrompt && {
              key: pinPrompt.room.key,
              roomName: pinPrompt.room.name,
              hostName: pinPrompt.room.hostName,
              error: pinPrompt.error,
              lockedUntil: pinPrompt.lockedUntil
            }
          }
          onPinSubmit={(pin) => pinPrompt && void join(pinPrompt.room, pin)}
          onPinCancel={() => setPinPrompt(null)}
          busyKey={busyKey}
          collapsed={roomsDocked ? sidebar === 'closed' && !pinPrompt : !roomsFloatingNow}
          onToggle={() => (roomsDocked ? setSidebar(sidebar === 'open' ? 'closed' : 'open') : setRoomsFloating((v) => !v))}
          onJoin={switchTo}
          onJoinEndpoint={(ep) => void switchToEndpoint(ep)}
          onForgetRecent={(ep) =>
            void updateSettings({ recentRooms: settings.recentRooms.filter((r) => !sameEndpoint(r, ep)) })
          }
          onCreate={openCreate}
          onSettings={() => setSettingsOpen(true)}
          onRename={(displayName) => void updateSettings({ displayName })}
        />
        <main className="shell-main">
          {session ? (
            <RoomView
              key={session.client.url}
              session={session}
              settings={settings}
              onLeave={leave}
              onChangeSettings={(p) => void updateSettings(p)}
              onToast={toast}
            />
          ) : (
            <Welcome hasRooms={rooms.length > 0} onCreate={openCreate} />
          )}
        </main>
      </div>

      {creating && (
        <CreateRoomDialog
          defaultName={t('common.defaultRoomName', { name: settings.displayName })}
          defaultAudio={audioDefaults(settings)}
          busy={createBusy}
          error={createError}
          onCancel={() => setCreating(false)}
          onCreate={(r) => void create(r)}
        />
      )}


      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          encoders={codecs.encoders}
          decoders={codecs.decoders}
          onChange={(p) => void updateSettings(p)}
          onRestartToUpdate={restartToUpdate}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <ConfirmDialog />

      <div className="toasts" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast ${item.tone}`}>
            {item.message}
          </div>
        ))}
      </div>
    </>
  )
}

/** The room we're in, kept up to date for the sidebar. */
function useCurrentRoom(session: Session | null): CurrentRoom | null {
  const [room, setRoom] = useState<RoomState | null>(session?.client.room ?? null)
  useEffect(() => {
    setRoom(session?.client.room ?? null)
    return session?.client.on('room', setRoom)
  }, [session])
  if (!session) return null
  return {
    id: room?.id ?? '',
    name: room?.name ?? session.endpoint.name ?? translator().t('common.room'),
    endpoint: session.role === 'host' ? null : session.endpoint,
    people: room ? room.viewerCount + 1 : 1,
    live: room?.streams ?? 0
  }
}
