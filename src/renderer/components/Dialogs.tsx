import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { DEFAULT_PIN_LENGTH, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../../shared/constants'
import {
  centredOffset,
  clampOffset,
  clampZoom,
  cropRect,
  cropScale,
  MAX_CROP_ZOOM,
  MIN_CROP_ZOOM,
  zoomAt,
  type CropView,
  type Point
} from '../../shared/crop'
import { formatDiagnostics } from '../../shared/diagnostics'
import { qualityPresets } from '../../shared/quality'
import { qualityLabel } from '../lib/quality'
import { LANGUAGES, type LanguageSetting } from '../../shared/i18n'
import { THEMES } from '../../shared/themes'
import type { AppInfo, AudioChoice, CodecSupport, DiscoveredRoom, Privacy, Settings } from '../../shared/types'
import { autoCodec, codecDisplayName } from '../../shared/codecs'
import { errorMessage } from '../lib/format'
import { loadPicture, renderAvatar } from '../lib/images'
import { useConfirmRequest } from '../lib/confirm'
import { systemLanguage, useT } from '../lib/i18n'
import { useUpdateStatus } from '../lib/update'
import { Avatar } from './Avatar'
import { Icon, type IconName } from './Icon'
import { SourcePicker } from './SourcePicker'

export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const { t } = useT()
  const backdrop = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // With dialogs stacked (e.g. the picture cropper over Settings), only the top one closes.
      const open = document.querySelectorAll('.modal-backdrop')
      if (open[open.length - 1] === backdrop.current) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div ref={backdrop} className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} title={t('common.close')}>
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
  audio: AudioChoice
}

/**
 * "Share system audio" switch, plus on Windows "Only this app's sound" (when
 * a window is chosen) and "Leave out Discord"; hidden on platforms that
 * cannot capture audio.
 */
function AudioToggle({
  value,
  onChange,
  sourceId
}: {
  value: AudioChoice
  onChange(v: AudioChoice): void
  /** The chosen source: "Only this app's sound" applies to windows. */
  sourceId: string | null
}) {
  const { t } = useT()
  const [supported, setSupported] = useState<boolean | null>(null)
  const [platform, setPlatform] = useState('')
  useEffect(() => {
    void window.api.capture.audioSupported().then(setSupported)
    void window.api.system.info().then((i) => setPlatform(i.platform))
  }, [])
  if (supported === false) return null
  const windows = platform === 'win32'
  const canLeaveOutDiscord = windows || platform === 'darwin'
  const windowChosen = sourceId?.startsWith('window:') ?? false
  const appOnly = windows && windowChosen && value.appOnly
  const set = (patch: Partial<AudioChoice>): void => onChange({ ...value, ...patch })
  return (
    <>
      <label className="toggle-row">
        <div>
          <span>
            <Icon name="volume" size={14} /> {t('audio.share')}
          </span>
          <span className="muted small block">
            {appOnly ? t('audio.appOnlyHint') : t('audio.everythingHint')}
            {platform === 'darwin' ? ` ${t('audio.macRequirement')}` : ''}
          </span>
        </div>
        <input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
      </label>
      {windows && windowChosen && (
        <label className={`toggle-row nested ${value.enabled ? '' : 'disabled'}`}>
          <div>
            <span>{t('audio.appOnly')}</span>
            <span className="muted small block">{t('audio.appOnlyDetail')}</span>
          </div>
          <input
            type="checkbox"
            checked={value.appOnly}
            disabled={!value.enabled}
            onChange={(e) => set({ appOnly: e.target.checked })}
          />
        </label>
      )}
      {canLeaveOutDiscord && !appOnly && (
        <label className={`toggle-row nested ${value.enabled ? '' : 'disabled'}`}>
          <div>
            <span>{t('audio.leaveOutDiscord')}</span>
            <span className="muted small block">{t('audio.leaveOutDiscordDetail')}</span>
          </div>
          <input
            type="checkbox"
            checked={value.excludeDiscord}
            disabled={!value.enabled}
            onChange={(e) => set({ excludeDiscord: e.target.checked })}
          />
        </label>
      )}
    </>
  )
}

export function CreateRoomDialog({
  defaultName,
  defaultAudio,
  busy,
  error,
  onCancel,
  onCreate
}: {
  defaultName: string
  defaultAudio: AudioChoice
  busy: boolean
  error: string | null
  onCancel(): void
  onCreate(r: CreateRoomResult): void
}) {
  const { t } = useT()
  const [name, setName] = useState(defaultName)
  const [privacy, setPrivacy] = useState<Privacy>('public')
  const [pinLength, setPinLength] = useState(DEFAULT_PIN_LENGTH)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [audio, setAudio] = useState(defaultAudio)

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!sourceId) return
    onCreate({ name: name.trim() || defaultName, privacy, pinLength, sourceId, audio })
  }

  return (
    <Modal title={t('common.createRoom')} onClose={onCancel} wide>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-row">
          <label htmlFor="room-name">{t('create.roomName')}</label>
          <input id="room-name" autoFocus maxLength={48} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-row">
          <label>{t('create.access')}</label>
          <div className="privacy-options">
            <button
              type="button"
              className={`privacy-option ${privacy === 'public' ? 'selected' : ''}`}
              onClick={() => setPrivacy('public')}
            >
              <Icon name="globe" size={18} />
              <strong>{t('common.public')}</strong>
              <span className="muted small">{t('create.publicHint')}</span>
            </button>
            <button
              type="button"
              className={`privacy-option ${privacy === 'private' ? 'selected' : ''}`}
              onClick={() => setPrivacy('private')}
            >
              <Icon name="lock" size={18} />
              <strong>{t('common.private')}</strong>
              <span className="muted small">{t('create.privateHint')}</span>
            </button>
          </div>
        </div>
        {privacy === 'private' && (
          <div className="form-row inline">
            <label htmlFor="pin-length">{t('create.pinLength')}</label>
            <select id="pin-length" value={pinLength} onChange={(e) => setPinLength(Number(e.target.value))}>
              {Array.from({ length: PIN_MAX_LENGTH - PIN_MIN_LENGTH + 1 }, (_, i) => PIN_MIN_LENGTH + i).map((n) => (
                <option key={n} value={n}>
                  {t('create.digits', { count: n })}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="form-row">
          <label>{t('create.whatToShare')}</label>
          <SourcePicker selected={sourceId} onSelect={setSourceId} />
        </div>
        <AudioToggle value={audio} onChange={setAudio} sourceId={sourceId} />
        {error && <div className="notice error">{error}</div>}
        <footer className="modal-footer">
          <button type="button" className="btn ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!sourceId || busy}>
            <Icon name="play" /> {busy ? t('create.starting') : t('create.startSharing')}
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
  onCancel,
  onPick
}: {
  current: string | null
  currentAudio: AudioChoice
  onCancel(): void
  onPick(id: string, audio: AudioChoice): void
}) {
  const { t } = useT()
  const [sourceId, setSourceId] = useState<string | null>(current)
  const [audio, setAudio] = useState(currentAudio)
  return (
    <Modal title={t('source.title')} onClose={onCancel} wide>
      <div className="modal-body">
        <SourcePicker selected={sourceId} onSelect={setSourceId} />
        <AudioToggle value={audio} onChange={setAudio} sourceId={sourceId} />
        <footer className="modal-footer">
          <button className="btn ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={!sourceId}
            onClick={() => sourceId && onPick(sourceId, audio)}
          >
            {t('source.share')}
          </button>
        </footer>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

const SETTINGS_SECTIONS = ['profile', 'appearance', 'sharing', 'general', 'advanced', 'about'] as const
type SettingsSection = (typeof SETTINGS_SECTIONS)[number]
const SECTION_ICONS: Record<SettingsSection, IconName> = {
  profile: 'user',
  appearance: 'palette',
  sharing: 'screen',
  general: 'sliders',
  advanced: 'code',
  about: 'info'
}
const PLATFORM_NAMES: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }

/** A titled box of settings, one per row. */
function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="settings-group">
      {title && <h3 className="settings-group-title">{title}</h3>}
      <div className="settings-card">{children}</div>
    </div>
  )
}

/** A setting chosen from a list: its name and what it does on the left, the list on the right. */
function SelectRow({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <label htmlFor={id}>{label}</label>
        {hint && (
          <span id={`${id}-hint`} className="muted small">
            {hint}
          </span>
        )}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

export function SettingsPanel({
  settings,
  encoders,
  decoders,
  onChange,
  onRestartToUpdate,
  onClose
}: {
  settings: Settings
  encoders: CodecSupport[]
  decoders: CodecSupport[]
  onChange(patch: Partial<Settings>): void
  onRestartToUpdate(): void
  onClose(): void
}) {
  const { t } = useT()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [cropping, setCropping] = useState<{ picture: ImageBitmap; url: string } | null>(null)
  const [section, setSection] = useState<SettingsSection>('profile')
  useEffect(() => {
    void window.api.system.info().then(setInfo)
  }, [])

  const chooseAvatar = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setAvatarError(null)
    try {
      setCropping({ picture: await loadPicture(file), url: URL.createObjectURL(file) })
    } catch (err) {
      setAvatarError(errorMessage(err))
    }
  }

  const closeCropper = (): void => {
    if (cropping) {
      cropping.picture.close()
      URL.revokeObjectURL(cropping.url)
    }
    setCropping(null)
  }

  const saveCrop = async (crop: { x: number; y: number; size: number }): Promise<void> => {
    if (!cropping) return
    try {
      onChange({ avatar: await renderAvatar(cropping.picture, crop) })
    } catch (err) {
      setAvatarError(errorMessage(err))
    }
    closeCropper()
  }

  const toggle = (key: keyof Settings, label: string, hint?: string, tag?: string) => (
    <label className="toggle-row settings-row">
      <span className="settings-row-text">
        <span>
          {label}
          {tag && <span className="settings-tag">{tag}</span>}
        </span>
        {hint && <span className="muted small">{hint}</span>}
      </span>
      <input type="checkbox" checked={!!settings[key]} onChange={(e) => onChange({ [key]: e.target.checked })} />
    </label>
  )

  const presets = qualityPresets(window.api.perf.options.highFps)
  const preset = presets.find((p) => p.id === settings.maxQuality)
  const optimizeHint = {
    auto: t('settings.optimizeAutoHint'),
    motion: t('settings.optimizeMotionHint'),
    detail: t('settings.optimizeDetailHint')
  }[settings.contentHint]
  const auto = autoCodec(encoders)

  const pages: Record<SettingsSection, ReactNode> = {
    profile: (
      <SettingsGroup>
        <div className="settings-row">
          <div className="settings-row-text">
            <span>{t('settings.picture')}</span>
            <span className="muted small">{t('settings.pictureHint')}</span>
          </div>
          <div className="avatar-picker">
            <Avatar name={settings.displayName} color="var(--accent)" image={settings.avatar} size="large" />
            <label className="btn small">
              {settings.avatar ? t('settings.pictureChange') : t('settings.pictureChoose')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                hidden
                onChange={(e) => {
                  void chooseAvatar(e.target.files?.[0])
                  e.target.value = '' // choosing the same file again still fires
                }}
              />
            </label>
            {settings.avatar && (
              <button className="btn ghost small" onClick={() => onChange({ avatar: null })}>
                {t('common.remove')}
              </button>
            )}
          </div>
        </div>
        {avatarError && <div className="notice error">{avatarError}</div>}
        <SelectRow id="display-name" label={t('settings.displayName')}>
          <input
            id="display-name"
            maxLength={32}
            defaultValue={settings.displayName}
            onBlur={(e) => e.target.value.trim() && onChange({ displayName: e.target.value.trim() })}
          />
        </SelectRow>
      </SettingsGroup>
    ),
    appearance: (
      <>
        <SettingsGroup>
          <SelectRow id="language" label={t('settings.language')}>
            <select
              id="language"
              value={settings.language}
              onChange={(e) => onChange({ language: e.target.value as LanguageSetting })}
            >
              <option value="system">
                {t('settings.languageSystem', {
                  language: LANGUAGES.find((l) => l.id === systemLanguage())?.name ?? ''
                })}
              </option>
              {LANGUAGES.map((l) => (
                // Each language in its own words, so anyone can find theirs.
                <option key={l.id} value={l.id} lang={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </SelectRow>
        </SettingsGroup>
        <div className="settings-group">
          <h3 className="settings-group-title">{t('settings.theme')}</h3>
          <div className="theme-picker" role="radiogroup" aria-label={t('settings.theme')}>
            {THEMES.map((theme) => {
              const [background, panel, accent, live] = theme.swatches
              const selected = settings.theme === theme.id
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`theme-option ${selected ? 'selected' : ''}`}
                  onClick={() => onChange({ theme: theme.id })}
                >
                  {/* The app in miniature: the room list, a stream with its live mark, a button. */}
                  <span className="theme-preview" aria-hidden="true" style={{ background }}>
                    <span className="theme-preview-side" style={{ background: panel }}>
                      <span style={{ background: accent }} />
                      <span />
                      <span />
                    </span>
                    <span className="theme-preview-stage">
                      <span className="theme-preview-tile">
                        <span style={{ background: live }} />
                      </span>
                      <span className="theme-preview-button" style={{ background: accent }} />
                    </span>
                  </span>
                  <span className="theme-label">
                    {t(`theme.${theme.id}`)}
                    {selected && <Icon name="check" size={14} stroke={2.6} />}
                  </span>
                  <span className="muted small">{t(`theme.${theme.id}.description`)}</span>
                </button>
              )
            })}
          </div>
        </div>
        <SettingsGroup title={t('settings.groupStreams')}>
          {toggle('showStatsOverlay', t('settings.showStats'), t('settings.showStatsHint'))}
        </SettingsGroup>
      </>
    ),
    sharing: (
      <>
        <SettingsGroup title={t('settings.groupPicture')}>
          <SelectRow
            id="max-quality"
            label={t('settings.maxQuality')}
            hint={preset && t('settings.maxQualityHint', { mbps: preset.maxBitrate / 1_000_000 })}
          >
            <select
              id="max-quality"
              aria-describedby="max-quality-hint"
              value={settings.maxQuality}
              onChange={(e) => onChange({ maxQuality: e.target.value as Settings['maxQuality'] })}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {qualityLabel(p)}
                </option>
              ))}
            </select>
          </SelectRow>
          <SelectRow id="content-hint" label={t('settings.optimizeFor')} hint={optimizeHint}>
            <select
              id="content-hint"
              aria-describedby="content-hint-hint"
              value={settings.contentHint}
              onChange={(e) => onChange({ contentHint: e.target.value as Settings['contentHint'] })}
            >
              <option value="auto">{t('settings.optimizeAuto')}</option>
              <option value="motion">{t('settings.optimizeMotion')}</option>
              <option value="detail">{t('settings.optimizeDetail')}</option>
            </select>
          </SelectRow>
          <SelectRow id="upload-budget" label={t('settings.uploadLimit')} hint={t('settings.uploadLimitHint')}>
            <select
              id="upload-budget"
              aria-describedby="upload-budget-hint"
              value={settings.uploadBudgetMbps}
              onChange={(e) => onChange({ uploadBudgetMbps: Number(e.target.value) })}
            >
              <option value={0}>{t('settings.uploadUnlimited')}</option>
              <option value={200}>{t('common.mbps', { value: 200 })}</option>
              <option value={100}>{t('settings.uploadDefault', { mbps: 100 })}</option>
              <option value={60}>{t('settings.uploadGoodWifi', { mbps: 60 })}</option>
              <option value={30}>{t('common.mbps', { value: 30 })}</option>
              <option value={15}>{t('settings.uploadSlow', { mbps: 15 })}</option>
            </select>
          </SelectRow>
        </SettingsGroup>
        <SettingsGroup title={t('settings.groupSound')}>
          {toggle('shareAudio', t('settings.shareAudio'), t('settings.shareAudioHint'))}
          {info?.platform === 'win32' && toggle('appAudioOnly', t('settings.appAudioOnly'), t('settings.appAudioOnlyHint'))}
          {(info?.platform === 'win32' || info?.platform === 'darwin') &&
            toggle('excludeDiscordAudio', t('settings.excludeDiscord'), t('settings.excludeDiscordHint'))}
        </SettingsGroup>
        <SettingsGroup title={t('settings.groupWhileSharing')}>
          {toggle('pauseOnMinimize', t('settings.pauseOnMinimize'), t('settings.pauseOnMinimizeHint'))}
          {toggle('allowDrawing', t('settings.allowDrawing'), t('settings.allowDrawingHint'))}
        </SettingsGroup>
      </>
    ),
    general: (
      <>
        <SettingsGroup>
          {toggle('notifications', t('settings.chatNotifications'))}
          {toggle('autoRejoin', t('settings.autoRejoin'))}
        </SettingsGroup>
        <SettingsGroup title={t('settings.groupNetwork')}>
          {toggle('useTls', t('settings.useTls'), t('settings.useTlsHint'))}
          {toggle('forceTcp', t('settings.forceTcp'), t('settings.forceTcpHint'))}
          <SelectRow id="port" label={t('settings.port')}>
            <input
              id="port"
              type="number"
              min={0}
              max={65535}
              defaultValue={settings.preferredPort}
              onBlur={(e) => onChange({ preferredPort: Number(e.target.value) })}
            />
          </SelectRow>
        </SettingsGroup>
      </>
    ),
    advanced: (
      <>
        <SettingsGroup>
          <SelectRow
            id="codec"
            label={t('settings.codec')}
            hint={
              auto
                ? t(auto.hardware ? 'settings.codecAutoHardware' : 'settings.codecAutoSoftware', {
                    codec: codecDisplayName(auto.mimeType)
                  })
                : undefined
            }
          >
            <select
              id="codec"
              aria-describedby="codec-hint"
              value={settings.codec}
              onChange={(e) => onChange({ codec: e.target.value as Settings['codec'] })}
            >
              <option value="auto">{t('settings.codecAuto')}</option>
              <option value="h264">H.264</option>
              <option value="h265">H.265 / HEVC</option>
              <option value="vp9">VP9</option>
              <option value="av1">AV1</option>
            </select>
          </SelectRow>
          {toggle('adaptiveQuality', t('settings.adaptive'), t('settings.adaptiveHint'))}
          {toggle('lowLatency', t('settings.lowLatency'), t('settings.lowLatencyHint'), t('settings.restartNeeded'))}
        </SettingsGroup>
        <CodecTable encoders={encoders} decoders={decoders} />
      </>
    ),
    about: (
      <>
        <div className="about-header">
          <span className="about-mark">
            <Icon name="screen" size={28} stroke={2} />
          </span>
          <span className="about-text">
            <span className="about-name">{info ? `ScreenShare ${info.version}` : 'ScreenShare'}</span>
            <span className="muted">{info ? (PLATFORM_NAMES[info.platform] ?? info.platform) : ''}</span>
          </span>
        </div>
        <SettingsGroup>
          {toggle(
            'autoUpdate',
            t('settings.autoUpdate'),
            info?.platform === 'darwin' ? t('settings.autoUpdateHintMac') : t('settings.autoUpdateHint')
          )}
          <UpdateRow onRestart={onRestartToUpdate} />
        </SettingsGroup>
        <SettingsGroup title={t('settings.groupTroubleshooting')}>
          <DiagnosticsRow encoders={encoders} decoders={decoders} />
        </SettingsGroup>
      </>
    )
  }

  return (
    <>
      <Modal title={t('common.settings')} onClose={onClose} wide>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label={t('settings.sections')}>
            {SETTINGS_SECTIONS.map((id) => (
              <button
                key={id}
                className={section === id ? 'active' : ''}
                aria-current={section === id ? 'true' : undefined}
                onClick={() => setSection(id)}
              >
                <Icon name={SECTION_ICONS[id]} size={16} />
                {t(`settings.${id}`)}
              </button>
            ))}
          </nav>
          <div className="modal-body settings">
            <section data-section={section} key={section}>
              <header className="settings-page-header">
                <h3>{t(`settings.${section}`)}</h3>
                <p className="muted">{t(`settings.${section}Intro`)}</p>
              </header>
              {pages[section]}
            </section>
          </div>
        </div>
      </Modal>
      {cropping && (
        <AvatarCropper
          picture={cropping.picture}
          url={cropping.url}
          onCancel={closeCropper}
          onSave={(crop) => void saveCrop(crop)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------

/** Side of the crop area in CSS pixels. */
const CROP_VIEW = 256
/** Side of the live preview. */
const CROP_PREVIEW = 64

/**
 * Pick the part of a picture to use as a profile picture: drag to move,
 * scroll (or the slider) to zoom. The circle shows what others will see.
 */
function AvatarCropper({
  picture,
  url,
  onCancel,
  onSave
}: {
  picture: ImageBitmap
  url: string
  onCancel(): void
  onSave(crop: { x: number; y: number; size: number }): void
}) {
  const { t } = useT()
  const v: CropView = { view: CROP_VIEW, imageWidth: picture.width, imageHeight: picture.height }
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Point>(() => centredOffset(v))
  const area = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; start: Point } | null>(null)
  // Latest values for the native wheel listener.
  const current = useRef({ zoom, offset })
  current.current = { zoom, offset }

  const zoomTo = (to: number, anchor: Point = { x: CROP_VIEW / 2, y: CROP_VIEW / 2 }): void => {
    const { zoom: from, offset: at } = current.current
    setOffset(zoomAt(v, from, to, at, anchor))
    setZoom(clampZoom(to))
  }

  // Wheel zoom around the pointer; non-passive so the dialog doesn't scroll.
  useEffect(() => {
    const el = area.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomTo(current.current.zoom * Math.pow(1.0015, -e.deltaY), { x: e.clientX - r.left, y: e.clientY - r.top })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picture])

  const onKey = (e: ReactKeyboardEvent): void => {
    const step = e.shiftKey ? 32 : 8
    const moves: Record<string, Point> = {
      ArrowLeft: { x: step, y: 0 },
      ArrowRight: { x: -step, y: 0 },
      ArrowUp: { x: 0, y: step },
      ArrowDown: { x: 0, y: -step }
    }
    if (moves[e.key]) {
      e.preventDefault()
      setOffset(clampOffset(v, zoom, { x: offset.x + moves[e.key].x, y: offset.y + moves[e.key].y }))
    } else if (e.key === '+' || e.key === '=') {
      zoomTo(zoom * 1.2)
    } else if (e.key === '-') {
      zoomTo(zoom / 1.2)
    }
  }

  const scale = cropScale(v, zoom)
  const placed = (k: number) => ({
    width: picture.width * scale * k,
    height: picture.height * scale * k,
    transform: `translate(${offset.x * k}px, ${offset.y * k}px)`
  })

  return (
    <Modal title={t('crop.title')} onClose={onCancel}>
      <div className="modal-body">
        <div className="cropper-row">
          <div
            ref={area}
            className="cropper"
            style={{ width: CROP_VIEW, height: CROP_VIEW }}
            tabIndex={0}
            aria-label={t('crop.area')}
            onKeyDown={onKey}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current = { x: e.clientX, y: e.clientY, start: offset }
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (d) setOffset(clampOffset(v, zoom, { x: d.start.x + e.clientX - d.x, y: d.start.y + e.clientY - d.y }))
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            <img src={url} alt="" draggable={false} style={placed(1)} />
            <div className="cropper-mask" />
          </div>
          <div className="cropper-side">
            <div className="cropper-preview" style={{ width: CROP_PREVIEW, height: CROP_PREVIEW }}>
              <img src={url} alt="" draggable={false} style={placed(CROP_PREVIEW / CROP_VIEW)} />
            </div>
            <span className="muted small">{t('crop.preview')}</span>
          </div>
        </div>
        <div className="cropper-zoom">
          <button className="icon-btn" title={t('crop.zoomOut')} onClick={() => zoomTo(zoom / 1.2)}>
            <Icon name="zoomOut" size={16} />
          </button>
          <input
            type="range"
            aria-label={t('crop.zoom')}
            min={MIN_CROP_ZOOM}
            max={MAX_CROP_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => zoomTo(Number(e.target.value))}
          />
          <button className="icon-btn" title={t('crop.zoomIn')} onClick={() => zoomTo(zoom * 1.2)}>
            <Icon name="zoomIn" size={16} />
          </button>
        </div>
        <p className="muted small">{t('crop.help')}</p>
        <footer className="modal-footer">
          <button className="btn ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={() => onSave(cropRect(v, zoom, offset))}>
            {t('crop.use')}
          </button>
        </footer>
      </div>
    </Modal>
  )
}

function CodecTable({ encoders, decoders }: { encoders: CodecSupport[]; decoders: CodecSupport[] }) {
  const { t } = useT()
  const mimes = [...new Set([...encoders, ...decoders].map((c) => c.mimeType))]
  if (mimes.length === 0) return null
  const cell = (list: CodecSupport[], mime: string): { text: string; hardware: boolean } => {
    const c = list.find((x) => x.mimeType === mime)
    if (!c) return { text: '—', hardware: false }
    return { text: c.hardware ? t('settings.hardware') : t('settings.software'), hardware: c.hardware }
  }
  const onCard = encoders.filter((c) => c.hardware).map((c) => codecDisplayName(c.mimeType))
  return (
    <SettingsGroup title={t('settings.groupThisComputer')}>
      <details className="codec-details">
        <summary>
          <Icon name="chevronRight" size={14} />
          <span className="codec-details-title">{t('settings.codecSupport')}</span>
          <span className="muted small">
            {onCard.length > 0 ? t('settings.codecSummary', { codecs: onCard.join(', ') }) : t('settings.codecSummaryNone')}
          </span>
        </summary>
        <table className="codec-table">
          <thead>
            <tr>
              <th>{t('settings.codecName')}</th>
              <th>{t('settings.encode')}</th>
              <th>{t('settings.decode')}</th>
            </tr>
          </thead>
          <tbody>
            {mimes.map((m) => (
              <tr key={m}>
                <td>{codecDisplayName(m)}</td>
                <td className={cell(encoders, m).hardware ? 'good' : ''}>{cell(encoders, m).text}</td>
                <td className={cell(decoders, m).hardware ? 'good' : ''}>{cell(decoders, m).text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </SettingsGroup>
  )
}

/** The update status in Settings → About, with what can be done about it. */
/**
 * Copy (or save) what a bug report needs: versions, system, graphics and
 * codecs, network addresses, settings and the end of the log, without PINs,
 * tokens or our client id (see shared/diagnostics.ts).
 */
function DiagnosticsRow({ encoders, decoders }: { encoders: CodecSupport[]; decoders: CodecSupport[] }) {
  const { t } = useT()
  const [status, setStatus] = useState<'copied' | 'saved' | 'failed' | null>(null)
  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(null), 3000)
    return () => clearTimeout(timer)
  }, [status])
  const report = async (): Promise<string> =>
    formatDiagnostics({ ...(await window.api.system.diagnostics()), encoders, decoders })
  const copy = async (): Promise<void> => {
    try {
      await window.api.system.copyText(await report())
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
  }
  const save = async (): Promise<void> => {
    try {
      const name = `screenshare-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`
      if (await window.api.system.saveText(name, await report())) setStatus('saved')
    } catch {
      setStatus('failed')
    }
  }
  const message = { copied: t('settings.diagnosticsCopied'), saved: t('settings.diagnosticsSaved'), failed: t('settings.diagnosticsFailed') }
  return (
    <div className="diagnostics-row">
      <div className="settings-row-text">
        <span>{t('settings.troubleshooting')}</span>
        <span className="muted small">{t('settings.diagnosticsHint')}</span>
      </div>
      <div className="diagnostics-actions">
        <button className="btn primary small" onClick={() => void copy()}>
          <Icon name="copy" size={14} /> {t('settings.copyDiagnostics')}
        </button>
        <button className="btn small" aria-label={t('settings.saveDiagnosticsLabel')} onClick={() => void save()}>
          <Icon name="download" size={14} /> {t('settings.saveDiagnostics')}
        </button>
        <button className="btn small" onClick={() => void window.api.system.openLogs()}>
          <Icon name="folder" size={14} /> {t('settings.openLogs')}
        </button>
        <span className="muted small" role="status">
          {status && message[status]}
        </span>
      </div>
    </div>
  )
}

function UpdateRow({ onRestart }: { onRestart(): void }) {
  const status = useUpdateStatus()
  const { t, time } = useT()
  if (!status) return null
  const text = (() => {
    switch (status.state) {
      case 'unsupported':
        return t('update.unsupported')
      case 'idle':
        return status.checkedAt ? t('update.upToDate', { time: time(status.checkedAt) }) : t('update.notChecked')
      case 'checking':
        return t('update.checking')
      case 'downloading':
        return t('update.downloading', { version: status.version, percent: status.percent })
      case 'ready':
        return t('update.ready', { version: status.version })
      case 'available':
        return t('update.available', { version: status.version })
      case 'error':
        return status.message
    }
  })()
  return (
    <div className="settings-row update-row" role="status">
      <span className={`small ${status.state === 'error' ? 'bad-text' : 'muted'}`}>{text}</span>
      {status.state === 'ready' ? (
        <button className="btn primary small" onClick={onRestart}>
          <Icon name="refresh" size={14} /> {t('update.restartToUpdate')}
        </button>
      ) : status.state === 'available' ? (
        <button className="btn primary small" onClick={() => void window.api.update.openPage()}>
          <Icon name="download" size={14} /> {t('update.download')}
        </button>
      ) : (
        <button
          className="btn ghost small"
          disabled={status.state === 'unsupported' || status.state === 'checking' || status.state === 'downloading'}
          onClick={() => void window.api.update.check()}
        >
          {t('update.checkNow')}
        </button>
      )}
    </div>
  )
}

/**
 * The app's own confirmation dialog (see askConfirm in lib/confirm.ts), so
 * questions look like the rest of the app instead of the system's plain box.
 */
export function ConfirmDialog() {
  const question = useConfirmRequest()
  const { t } = useT()
  if (!question) return null
  return (
    <Modal title={question.title} onClose={() => question.answer(false)}>
      <div className="modal-body confirm-body">
        {question.message && <p className="confirm-message">{question.message}</p>}
        <footer className="modal-footer">
          <button className="btn ghost" autoFocus={question.danger} onClick={() => question.answer(false)}>
            {question.cancel ?? t('common.cancel')}
          </button>
          <button
            className={`btn ${question.danger ? 'solid-danger' : 'primary'}`}
            autoFocus={!question.danger}
            onClick={() => question.answer(true)}
          >
            {question.confirm}
          </button>
        </footer>
      </div>
    </Modal>
  )
}
