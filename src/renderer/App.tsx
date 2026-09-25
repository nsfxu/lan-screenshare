import { useCallback, useEffect, useRef, useState } from 'react'
import type { CodecSupport, DiscoveredRoom, RoomEndpoint, Settings } from '../shared/types'
import { CreateRoomDialog, PinDialog, SettingsPanel, type CreateRoomResult } from './components/Dialogs'
import { HomeScreen } from './components/HomeScreen'
import { RoomView } from './components/RoomView'
import { detectDecoders, detectEncoders } from './lib/codecs'
import { audioUnavailableMessage, errorMessage } from './lib/format'
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
  const sessionRef = useRef<Session | null>(null)
  sessionRef.current = session

  const toast = useCallback((message: string, tone: 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? Math.max(6000, message.length * 60) : 3000)
  }, [])

  // --- startup -----------------------------------------------------------------
  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    void window.api.rooms.list().then(setRooms)
    void Promise.all([detectEncoders(), detectDecoders()]).then(([encoders, decoders]) => {
      setCodecs({ encoders, decoders })
      window.api.system.log('info', `codecs enc=${JSON.stringify(encoders)} dec=${JSON.stringify(decoders)}`)
    })
    return window.api.rooms.onChanged(setRooms)
  }, [])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await window.api.settings.update(patch)
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
        void updateSettings({ lastRoom: endpoint })
      } catch (err) {
        if (err instanceof JoinError) {
          const d = err.detail
          if (d.code === 'pin_required' || d.code === 'bad_pin' || d.code === 'locked') {
            setPinPrompt({
              room,
              error:
                d.code === 'bad_pin'
                  ? `Wrong PIN.${d.attemptsLeft !== undefined ? ` ${d.attemptsLeft} attempt${d.attemptsLeft === 1 ? '' : 's'} left.` : ''}`
                  : null,
              lockedUntil: d.code === 'locked' ? Date.now() + (d.retryAfterMs ?? 0) : null
            })
            return
          }
          setPinPrompt(null)
          toast(d.message, 'error')
        } else {
          setPinPrompt(null)
          toast(`Could not join: ${errorMessage(err)}`, 'error')
        }
      } finally {
        setBusyKey(null)
      }
    },
    [settings, codecs, toast, updateSettings]
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
      .catch(() => toast(`Last room (${last.name ?? last.address}) is not available`, 'info'))
  }, [settings, join, toast])

  // --- hosting ---------------------------------------------------------------------
  const create = async (req: CreateRoomResult): Promise<void> => {
    if (!settings) return
    setCreateBusy(true)
    setCreateError(null)
    let hostedCreated = false
    try {
      const hosted = await window.api.host.create({ name: req.name, privacy: req.privacy, pinLength: req.pinLength })
      hostedCreated = true
      const s = await hostRoom(hosted, settings, codecs)
      try {
        await s.publisher.startCapture(req.sourceId, req.audio)
        if (req.audio && !s.publisher.hasAudio) toast(audioUnavailableMessage(s.publisher.audioError), 'error')
      } catch (err) {
        toast(`Room created, but capture failed: ${errorMessage(err)}`, 'error')
      }
      setSession(s)
      setCreating(false)
      if (hosted.pin) {
        void window.api.system.copyText(hosted.pin)
        toast(`Private room created. PIN ${hosted.pin} copied to clipboard.`)
      }
    } catch (err) {
      setCreateError(errorMessage(err))
      if (hostedCreated) void window.api.host.close()
    } finally {
      setCreateBusy(false)
    }
  }

  const leave = useCallback(
    (reason?: string) => {
      const s = sessionRef.current
      if (!s) return
      sessionRef.current = null
      setSession(null)
      disposeSession(s)
      if (s.role === 'host') void window.api.host.close()
      if (reason && reason !== 'You left the room') toast(reason, s.role === 'host' ? 'info' : 'error')
    },
    [toast]
  )

  if (!settings) return <div className="boot">Loading…</div>

  return (
    <>
      {session ? (
        <RoomView key={session.client.url} session={session} settings={settings} onLeave={leave} onToast={toast} />
      ) : (
        <HomeScreen
          settings={settings}
          rooms={rooms}
          busyKey={busyKey}
          onJoin={(r) => void join(r)}
          onCreate={() => {
            setCreateError(null)
            setCreating(true)
          }}
          onSettings={() => setSettingsOpen(true)}
          onRename={(displayName) => void updateSettings({ displayName })}
        />
      )}

      {creating && !session && (
        <CreateRoomDialog
          defaultName={`${settings.displayName}'s room`}
          defaultAudio={settings.shareAudio}
          busy={createBusy}
          error={createError}
          onCancel={() => setCreating(false)}
          onCreate={(r) => void create(r)}
        />
      )}

      {pinPrompt && !session && (
        <PinDialog
          room={pinPrompt.room}
          busy={busyKey === pinPrompt.room.key}
          error={pinPrompt.error}
          lockedUntil={pinPrompt.lockedUntil}
          onCancel={() => setPinPrompt(null)}
          onSubmit={(pin) => void join(pinPrompt.room, pin)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          encoders={codecs.encoders}
          decoders={codecs.decoders}
          hosting={session?.role === 'host'}
          onChange={(p) => void updateSettings(p)}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </>
  )
}
