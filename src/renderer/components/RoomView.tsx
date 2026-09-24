import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatMessage, HostedRoom, HostStats, MediaState, Participant, RoomState, Settings, ViewerStats } from '../../shared/types'
import { audioUnavailableMessage, errorMessage, formatBitrate, formatDuration, latencyClass } from '../lib/format'
import type { ConnectionState } from '../lib/roomClient'
import type { SharingState } from '../lib/hostStreamer'
import type { Session } from '../lib/session'
import { ChatPanel } from './ChatPanel'
import { ChangeSourceDialog } from './Dialogs'
import { AccessPanel, HostStatsPanel } from './HostControls'
import { Icon } from './Icon'
import { ScreenViewer } from './ScreenViewer'
import { ViewerList } from './ViewerList'

interface Props {
  session: Session
  settings: Settings
  onLeave(reason?: string): void
  onToast(message: string, tone?: 'error' | 'info'): void
}

/** The in-room interface: stream on the left, people + chat on the right. */
export function RoomView({ session, settings, onLeave, onToast }: Props) {
  const { client } = session
  const isHost = session.role === 'host'
  const [room, setRoom] = useState<RoomState | null>(client.room)
  const [participants, setParticipants] = useState<Participant[]>(client.participants)
  const [messages, setMessages] = useState<ChatMessage[]>(client.messages)
  const [connection, setConnection] = useState<ConnectionState>(client.state)
  const [stream, setStream] = useState<MediaStream | null>(
    session.role === 'host' ? session.streamer.stream : session.receiver.stream
  )
  const [mediaState, setMediaState] = useState<MediaState>(session.role === 'viewer' ? session.receiver.state : 'idle')
  const [ownStats, setOwnStats] = useState<ViewerStats | null>(null)
  const [hostStats, setHostStats] = useState<HostStats | null>(null)
  const [viewerStats, setViewerStats] = useState<Map<string, ViewerStats>>(new Map())
  const [hosted, setHosted] = useState<HostedRoom | null>(session.role === 'host' ? session.hosted : null)
  const [sharing, setSharing] = useState<SharingState>({ sharing: false, paused: false, hasAudio: false, audioMuted: false })
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
    return () => offs.forEach((o) => o())
  }, [client, settings.notifications, onLeave, onToast])

  useEffect(() => {
    if (session.role === 'host') {
      const s = session.streamer
      setSharing(s.state)
      const offs = [
        s.on('stream', setStream),
        s.on('sharing', setSharing),
        s.on('stats', setHostStats),
        s.on('viewerStats', (m) => setViewerStats(new Map(m))),
        window.api.host.onChanged((h) => h && setHosted(h))
      ]
      return () => offs.forEach((o) => o())
    }
    const r = session.receiver
    const offs = [r.on('stream', setStream), r.on('state', setMediaState), r.on('stats', setOwnStats)]
    return () => offs.forEach((o) => o())
  }, [session])

  // Viewers may not record the stream: hide the window from screen capture.
  useEffect(() => {
    if (isHost) return
    void window.api.system.setViewerProtection(!(room?.allowRecording ?? false))
    return () => void window.api.system.setViewerProtection(false)
  }, [isHost, room?.allowRecording])

  // Optional: pause while minimized, resume when restored.
  useEffect(() => {
    if (session.role !== 'host') return
    const s = session.streamer
    return window.api.system.onWindowState((state) => {
      if (!settings.pauseOnMinimize) return
      if (state === 'minimized' && s.sharing && !s.paused) {
        autoPaused.current = true
        s.setPaused(true)
      } else if (state === 'restored' && autoPaused.current) {
        autoPaused.current = false
        s.setPaused(false)
      }
    })
  }, [session, settings.pauseOnMinimize])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // --- actions ---------------------------------------------------------------
  const shareSource = async (id: string, audio: boolean): Promise<void> => {
    if (session.role !== 'host') return
    setPickSource(false)
    try {
      await session.streamer.startCapture(id, audio)
      if (audio && !session.streamer.hasAudio) onToast(audioUnavailableMessage(session.streamer.audioError), 'error')
    } catch (err) {
      onToast(`Could not capture: ${errorMessage(err)}`, 'error')
    }
  }

  const endRoom = (): void => {
    if (!confirm('End the room for everyone?')) return
    onLeave()
  }

  // --- rendering -------------------------------------------------------------
  const hostName = participants.find((p) => p.role === 'host')?.name ?? room?.hostName ?? 'the host'
  const paused = isHost ? sharing.paused : !!room?.paused
  let placeholder: ReactNode = null
  if (isHost) {
    if (!sharing.sharing) {
      placeholder = (
        <div className="placeholder-content">
          <Icon name="screen" size={40} />
          <h3>You are not sharing</h3>
          <p className="muted">Viewers stay in the room and see your screen as soon as you share.</p>
          <button className="btn primary" onClick={() => setPickSource(true)}>
            <Icon name="play" /> Share screen
          </button>
        </div>
      )
    } else if (paused) {
      placeholder = (
        <div className="placeholder-content paused">
          <Icon name="pause" size={32} />
          <h3>Sharing paused</h3>
          <p className="muted">Viewers see a paused screen until you resume.</p>
        </div>
      )
    }
  } else if (!room?.sharing) {
    placeholder = (
      <div className="placeholder-content">
        <div className="pulse-ring">
          <Icon name="screen" size={36} />
        </div>
        <h3>Waiting for {hostName} to share</h3>
        <p className="muted">The stream starts automatically.</p>
      </div>
    )
  } else if (paused) {
    placeholder = (
      <div className="placeholder-content paused">
        <Icon name="pause" size={32} />
        <h3>Paused by {hostName}</h3>
      </div>
    )
  } else if (mediaState === 'negotiating' || !stream) {
    placeholder = (
      <div className="placeholder-content">
        <div className="spinner" />
        <h3>Connecting to stream…</h3>
      </div>
    )
  }

  const overlay = settings.showStatsOverlay ? (
    isHost ? (
      hostStats && sharing.sharing ? (
        <div className="stat-badges">
          <span className="stat-badge">{Math.round(hostStats.fps)} fps</span>
          <span className="stat-badge">{formatBitrate(hostStats.bitrateKbps)}</span>
          {sharing.hasAudio && (
            <span className={`stat-badge ${sharing.audioMuted ? 'muted-badge' : ''}`}>
              {sharing.audioMuted ? 'audio muted' : `audio ${hostStats.audioKbps ?? 0} kbps`}
            </span>
          )}
          <span className={`stat-badge ${hostStats.cpuPercent < 20 ? 'good' : 'ok'}`}>CPU {hostStats.cpuPercent.toFixed(0)}%</span>
        </div>
      ) : null
    ) : ownStats && mediaState === 'streaming' ? (
      <div className="stat-badges">
        <span className="stat-badge">{ownStats.fps} fps</span>
        <span className={`stat-badge ${latencyClass(ownStats.latencyMs)}`} title="Estimated glass-to-glass latency">
          {ownStats.latencyMs === null ? '– ms' : `~${ownStats.latencyMs} ms`}
        </span>
        <span className="stat-badge">
          {ownStats.width}×{ownStats.height}
        </span>
        <span className="stat-badge">
          {ownStats.codec || '…'} · {ownStats.transport === 'tcp' ? 'TCP' : 'WebRTC'}
        </span>
        {!room?.audio && <span className="stat-badge muted-badge">no audio</span>}
      </div>
    ) : null
  ) : null

  return (
    <div className="room">
      <header className="room-header">
        <div className="room-title">
          <h2 title={room?.name}>{room?.name ?? 'Room'}</h2>
          <span className={`badge ${room?.privacy ?? 'public'}`}>
            <Icon name={room?.privacy === 'private' ? 'lock' : 'globe'} size={12} />
            {room?.privacy === 'private' ? 'Private' : 'Public'}
          </span>
          {room?.sharing && !paused && <span className="status-pill live">Live</span>}
          {connection === 'reconnecting' && <span className="status-pill warn">Reconnecting…</span>}
        </div>
        <div className="room-meta muted small">
          <span>
            <Icon name="users" size={13} /> {room?.viewerCount ?? 0} watching
          </span>
          {room && <span>{formatDuration(Date.now() - room.startedAt)}</span>}
          {client.rttMs !== null && <span title="Round trip to the room server">RTT {Math.round(client.rttMs)} ms</span>}
          {!isHost && <span className="mono">{session.endpoint.address}</span>}
        </div>
      </header>

      <div className="room-body">
        <main className="stage">
          <ScreenViewer
            stream={stream}
            placeholder={placeholder}
            overlay={overlay}
            local={isHost}
            audioAvailable={!!room?.audio && mediaState === 'streaming'}
          />
          {isHost && showStats && (
            <div className="stats-popover">
              <HostStatsPanel stats={hostStats} />
            </div>
          )}
          <div className="stage-toolbar">
            {session.role === 'host' ? (
              <>
                {sharing.sharing ? (
                  <>
                    <button className="btn" onClick={() => session.streamer.setPaused(!sharing.paused)}>
                      <Icon name={sharing.paused ? 'play' : 'pause'} /> {sharing.paused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      className={`btn ${sharing.hasAudio && sharing.audioMuted ? 'active' : ''}`}
                      disabled={!sharing.hasAudio}
                      title={sharing.hasAudio ? 'Mute or unmute the system audio viewers hear' : 'Audio is not being captured (enable it via Change source)'}
                      onClick={() => session.streamer.setAudioMuted(!sharing.audioMuted)}
                    >
                      <Icon name={sharing.hasAudio && !sharing.audioMuted ? 'volume' : 'volumeOff'} />
                      {!sharing.hasAudio ? 'No audio' : sharing.audioMuted ? 'Unmute audio' : 'Mute audio'}
                    </button>
                    <button className="btn" onClick={() => setPickSource(true)}>
                      <Icon name="swap" /> Change source
                    </button>
                    <button className="btn" onClick={() => session.streamer.stopSharing()}>
                      <Icon name="stop" /> Stop sharing
                    </button>
                  </>
                ) : (
                  <button className="btn primary" onClick={() => setPickSource(true)}>
                    <Icon name="play" /> Share screen
                  </button>
                )}
                <button className={`btn ${showStats ? 'active' : ''}`} onClick={() => setShowStats((v) => !v)}>
                  <Icon name="chart" /> Stats
                </button>
                <span className="spacer" />
                <button className="btn danger" onClick={endRoom}>
                  <Icon name="logout" /> End room
                </button>
              </>
            ) : (
              <>
                {ownStats && mediaState === 'streaming' && (
                  <span className="muted small toolbar-stats">
                    {formatBitrate(ownStats.bitrateKbps)}
                    {ownStats.audioKbps > 0 ? ` + ${ownStats.audioKbps} kbps audio` : ''}
                    {ownStats.packetLossPct >= 0.5 ? ` · ${ownStats.packetLossPct.toFixed(1)}% loss` : ''}
                    {ownStats.decoder ? ` · ${ownStats.decoder}` : ''}
                  </span>
                )}
                {session.receiver.transport === 'tcp' && room?.sharing && (
                  <button className="btn small" title="Try the low-latency WebRTC transport again" onClick={() => session.receiver.retry('webrtc')}>
                    <Icon name="refresh" /> Retry WebRTC
                  </button>
                )}
                <span className="spacer" />
                <button className="btn danger" onClick={() => onLeave()}>
                  <Icon name="logout" /> Leave
                </button>
              </>
            )}
          </div>
        </main>

        <aside className="sidebar">
          {isHost && hosted && <AccessPanel hosted={hosted} onToast={onToast} />}
          <ViewerList
            participants={participants}
            selfId={client.selfId}
            isHost={isHost}
            viewerStats={viewerStats}
            onKick={(id) => {
              const p = participants.find((x) => x.id === id)
              if (p && confirm(`Remove ${p.name} from the room?`)) client.send({ type: 'kick', userId: id })
            }}
          />
          <ChatPanel
            messages={messages}
            selfId={client.selfId}
            isHost={isHost}
            muted={!!room?.chatMuted}
            onSend={(text) => client.send({ type: 'chat', text })}
            onDelete={(id) => client.send({ type: 'delete-message', id })}
            onToggleMute={(muted) => client.send({ type: 'mute-chat', muted })}
          />
        </aside>
      </div>

      {pickSource && session.role === 'host' && (
        <ChangeSourceDialog
          current={session.streamer.sourceId}
          currentAudio={session.streamer.sharing ? session.streamer.hasAudio : settings.shareAudio}
          onCancel={() => setPickSource(false)}
          onPick={(id, audio) => void shareSource(id, audio)}
        />
      )}
    </div>
  )
}
