import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { DEFAULT_PIN_LENGTH, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../../shared/constants'
import { QUALITY_PRESETS } from '../../shared/quality'
import type { AppInfo, CodecSupport, DiscoveredRoom, Privacy, Settings } from '../../shared/types'
import { shortCodecName } from '../lib/codecs'
import { Icon } from './Icon'
import { SourcePicker } from './SourcePicker'

export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            <Icon name="x" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export interface CreateRoomResult {
  name: string
  privacy: Privacy
  pinLength: number
  sourceId: string
  audio: boolean
  excludeDiscord: boolean
}

/**
 * "Share system audio" switch, plus "Leave out Discord" on Windows; hidden on
 * platforms that cannot capture audio.
 */
function AudioToggle({
  value,
  onChange,
  excludeDiscord,
  onExcludeDiscordChange
}: {
  value: boolean
  onChange(v: boolean): void
  excludeDiscord: boolean
  onExcludeDiscordChange(v: boolean): void
}) {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [platform, setPlatform] = useState('')
  useEffect(() => {
    void window.api.capture.audioSupported().then(setSupported)
    void window.api.system.info().then((i) => setPlatform(i.platform))
  }, [])
  if (supported === false) return null
  return (
    <>
      <label className="toggle-row">
        <div>
          <span>
            <Icon name="volume" size={14} /> Share system audio
          </span>
          <span className="muted small block">
            Everything playing on this computer is shared, even when you pick a single window.
            {platform === 'darwin' ? ' Requires macOS 13 or later.' : ''}
          </span>
        </div>
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      </label>
      {platform === 'win32' && (
        <label className={`toggle-row nested ${value ? '' : 'disabled'}`}>
          <div>
            <span>Leave out Discord</span>
            <span className="muted small block">
              People in your Discord call won't hear themselves through your stream. Needs Windows 10 version 2004 or
              newer.
            </span>
          </div>
          <input
            type="checkbox"
            checked={excludeDiscord}
            disabled={!value}
            onChange={(e) => onExcludeDiscordChange(e.target.checked)}
          />
        </label>
      )}
    </>
  )
}

export function CreateRoomDialog({
  defaultName,
  defaultAudio,
  defaultExcludeDiscord,
  busy,
  error,
  onCancel,
  onCreate
}: {
  defaultName: string
  defaultAudio: boolean
  defaultExcludeDiscord: boolean
  busy: boolean
  error: string | null
  onCancel(): void
  onCreate(r: CreateRoomResult): void
}) {
  const [name, setName] = useState(defaultName)
  const [privacy, setPrivacy] = useState<Privacy>('public')
  const [pinLength, setPinLength] = useState(DEFAULT_PIN_LENGTH)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [audio, setAudio] = useState(defaultAudio)
  const [excludeDiscord, setExcludeDiscord] = useState(defaultExcludeDiscord)

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!sourceId) return
    onCreate({ name: name.trim() || defaultName, privacy, pinLength, sourceId, audio, excludeDiscord })
  }

  return (
    <Modal title="Create room" onClose={onCancel} wide>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-row">
          <label htmlFor="room-name">Room name</label>
          <input id="room-name" autoFocus maxLength={48} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Access</label>
          <div className="privacy-options">
            <button
              type="button"
              className={`privacy-option ${privacy === 'public' ? 'selected' : ''}`}
              onClick={() => setPrivacy('public')}
            >
              <Icon name="globe" size={18} />
              <strong>Public</strong>
              <span className="muted small">Anyone on the network can join</span>
            </button>
            <button
              type="button"
              className={`privacy-option ${privacy === 'private' ? 'selected' : ''}`}
              onClick={() => setPrivacy('private')}
            >
              <Icon name="lock" size={18} />
              <strong>Private</strong>
              <span className="muted small">Viewers need a PIN (generated for you)</span>
            </button>
          </div>
        </div>
        {privacy === 'private' && (
          <div className="form-row inline">
            <label htmlFor="pin-length">PIN length</label>
            <select id="pin-length" value={pinLength} onChange={(e) => setPinLength(Number(e.target.value))}>
              {Array.from({ length: PIN_MAX_LENGTH - PIN_MIN_LENGTH + 1 }, (_, i) => PIN_MIN_LENGTH + i).map((n) => (
                <option key={n} value={n}>
                  {n} digits
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="form-row">
          <label>What do you want to share?</label>
          <SourcePicker selected={sourceId} onSelect={setSourceId} />
        </div>
        <AudioToggle
          value={audio}
          onChange={setAudio}
          excludeDiscord={excludeDiscord}
          onExcludeDiscordChange={setExcludeDiscord}
        />
        {error && <div className="notice error">{error}</div>}
        <footer className="modal-footer">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!sourceId || busy}>
            <Icon name="play" /> {busy ? 'Starting…' : 'Start sharing'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

export function ChangeSourceDialog({
  current,
  currentAudio,
  currentExcludeDiscord,
  onCancel,
  onPick
}: {
  current: string | null
  currentAudio: boolean
  currentExcludeDiscord: boolean
  onCancel(): void
  onPick(id: string, audio: boolean, excludeDiscord: boolean): void
}) {
  const [sourceId, setSourceId] = useState<string | null>(current)
  const [audio, setAudio] = useState(currentAudio)
  const [excludeDiscord, setExcludeDiscord] = useState(currentExcludeDiscord)
  return (
    <Modal title="Choose what to share" onClose={onCancel} wide>
      <div className="modal-body">
        <SourcePicker selected={sourceId} onSelect={setSourceId} />
        <AudioToggle
          value={audio}
          onChange={setAudio}
          excludeDiscord={excludeDiscord}
          onExcludeDiscordChange={setExcludeDiscord}
        />
        <footer className="modal-footer">
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!sourceId}
            onClick={() => sourceId && onPick(sourceId, audio, excludeDiscord)}
          >
            Share
          </button>
        </footer>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

export function PinDialog({
  room,
  busy,
  error,
  lockedUntil,
  onCancel,
  onSubmit
}: {
  room: DiscoveredRoom
  busy: boolean
  error: string | null
  lockedUntil: number | null
  onCancel(): void
  onSubmit(pin: string): void
}) {
  const [pin, setPin] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!lockedUntil) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [lockedUntil])
  const lockedFor = lockedUntil ? Math.max(0, lockedUntil - now) : 0
  const valid = new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin)

  return (
    <Modal title={`Join “${room.name}”`} onClose={onCancel}>
      <form
        className="modal-body"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid && !lockedFor) onSubmit(pin)
        }}
      >
        <p className="muted">
          <Icon name="lock" size={14} /> This room is private. Ask {room.hostName || 'the host'} for the PIN.
        </p>
        <input
          className="pin-input"
          autoFocus
          inputMode="numeric"
          autoComplete="off"
          maxLength={PIN_MAX_LENGTH}
          placeholder="••••••"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          aria-label="Room PIN"
        />
        {lockedFor > 0 ? (
          <div className="notice error">Too many wrong attempts. Try again in {Math.ceil(lockedFor / 1000)} s.</div>
        ) : (
          error && <div className="notice error">{error}</div>
        )}
        <footer className="modal-footer">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid || busy || lockedFor > 0}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

export function SettingsPanel({
  settings,
  encoders,
  decoders,
  hosting,
  onChange,
  onClose
}: {
  settings: Settings
  encoders: CodecSupport[]
  decoders: CodecSupport[]
  hosting: boolean
  onChange(patch: Partial<Settings>): void
  onClose(): void
}) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.api.system.info().then(setInfo)
  }, [])

  const toggle = (key: keyof Settings, label: string, hint?: string) => (
    <label className="toggle-row">
      <div>
        <span>{label}</span>
        {hint && <span className="muted small block">{hint}</span>}
      </div>
      <input type="checkbox" checked={!!settings[key]} onChange={(e) => onChange({ [key]: e.target.checked })} />
    </label>
  )

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="modal-body settings">
        <section>
          <h3>Profile</h3>
          <div className="form-row inline">
            <label htmlFor="display-name">Display name</label>
            <input
              id="display-name"
              maxLength={32}
              defaultValue={settings.displayName}
              onBlur={(e) => e.target.value.trim() && onChange({ displayName: e.target.value.trim() })}
            />
          </div>
        </section>

        <section>
          <h3>Streaming quality {hosting && <span className="muted small">(applies to the next share)</span>}</h3>
          <div className="form-row inline">
            <label htmlFor="max-quality">Maximum quality</label>
            <select
              id="max-quality"
              value={settings.maxQuality}
              onChange={(e) => onChange({ maxQuality: e.target.value as Settings['maxQuality'] })}
            >
              {QUALITY_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} · up to {p.maxBitrate / 1_000_000} Mbps
                </option>
              ))}
            </select>
          </div>
          {toggle('adaptiveQuality', 'Adaptive quality', 'Lower resolution/frame rate per viewer when the network degrades')}
          <div className="form-row inline">
            <label htmlFor="codec">Video codec</label>
            <select id="codec" value={settings.codec} onChange={(e) => onChange({ codec: e.target.value as Settings['codec'] })}>
              <option value="auto">Automatic (hardware H.264 preferred)</option>
              <option value="h264">H.264</option>
              <option value="h265">H.265 / HEVC</option>
              <option value="vp9">VP9</option>
              <option value="av1">AV1</option>
            </select>
          </div>
          <div className="form-row inline">
            <label htmlFor="content-hint">Optimize for</label>
            <select
              id="content-hint"
              value={settings.contentHint}
              onChange={(e) => onChange({ contentHint: e.target.value as Settings['contentHint'] })}
            >
              <option value="motion">Smooth motion (keep 60 fps)</option>
              <option value="detail">Sharp text (keep resolution)</option>
            </select>
          </div>
          <div className="form-row inline">
            <label htmlFor="upload-budget">
              Upload limit when sharing
              <span className="muted small block">Shared between everyone watching you; applies immediately</span>
            </label>
            <select
              id="upload-budget"
              value={settings.uploadBudgetMbps}
              onChange={(e) => onChange({ uploadBudgetMbps: Number(e.target.value) })}
            >
              <option value={0}>Unlimited (wired gigabit)</option>
              <option value={200}>200 Mbps</option>
              <option value={100}>100 Mbps (default)</option>
              <option value={60}>60 Mbps (good Wi-Fi)</option>
              <option value={30}>30 Mbps</option>
              <option value={15}>15 Mbps (slow Wi-Fi / VPN)</option>
            </select>
          </div>
          <CodecTable encoders={encoders} decoders={decoders} />
        </section>

        <section>
          <h3>Network</h3>
          {toggle('useTls', 'Encrypt connections (TLS)', 'Chat and signaling use TLS; video is always DTLS-SRTP encrypted')}
          {toggle('forceTcp', 'Always use TCP transport', 'For VPNs/firewalls that block UDP (adds some latency)')}
          <div className="form-row inline">
            <label htmlFor="port">Hosting port</label>
            <input
              id="port"
              type="number"
              min={0}
              max={65535}
              defaultValue={settings.preferredPort}
              onBlur={(e) => onChange({ preferredPort: Number(e.target.value) })}
            />
          </div>
          {toggle('autoRejoin', 'Rejoin last room on startup')}
        </section>

        <section>
          <h3>Behaviour</h3>
          {toggle('notifications', 'Chat notifications when the window is in the background')}
          {toggle('pauseOnMinimize', 'Pause sharing while minimized', 'Sharing resumes automatically when restored')}
          {toggle('showStatsOverlay', 'Show FPS and latency overlay')}
          {toggle('shareAudio', 'Share system audio by default', 'Pre-selects the audio switch when you start sharing')}
          {info?.platform === 'win32' &&
            toggle(
              'excludeDiscordAudio',
              'Leave out Discord by default',
              "People in your Discord call don't hear themselves through your stream"
            )}
        </section>

        <footer className="modal-footer spread">
          <span className="muted small">
            {info ? `ScreenShare ${info.version} · ${info.platform}` : ''}
          </span>
          <button className="btn ghost small" onClick={() => void window.api.system.openLogs()}>
            <Icon name="folder" size={14} /> Open logs
          </button>
        </footer>
      </div>
    </Modal>
  )
}

function CodecTable({ encoders, decoders }: { encoders: CodecSupport[]; decoders: CodecSupport[] }) {
  const mimes = [...new Set([...encoders, ...decoders].map((c) => c.mimeType))]
  if (mimes.length === 0) return null
  const cell = (list: CodecSupport[], mime: string): string => {
    const c = list.find((x) => x.mimeType === mime)
    return !c ? '—' : c.hardware ? 'Hardware' : 'Software'
  }
  return (
    <table className="codec-table">
      <thead>
        <tr>
          <th>Codec</th>
          <th>Encode</th>
          <th>Decode</th>
        </tr>
      </thead>
      <tbody>
        {mimes.map((m) => (
          <tr key={m}>
            <td>{shortCodecName(m)}</td>
            <td className={cell(encoders, m) === 'Hardware' ? 'good' : ''}>{cell(encoders, m)}</td>
            <td className={cell(decoders, m) === 'Hardware' ? 'good' : ''}>{cell(decoders, m)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
