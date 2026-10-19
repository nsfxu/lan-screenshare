import { useEffect, useRef, type RefObject } from 'react'
import type { HostedRoom, RoomEndpoint, RoomState } from '../../shared/types'
import { formatDuration } from '../lib/format'
import { useT } from '../lib/i18n'
import { AccessPanel } from './HostControls'
import { Icon } from './Icon'

/** A panel over the controls closes on a click outside it (its own button toggles it) or Esc. */
function useClosesOutside(ref: RefObject<HTMLElement | null>, button: string, onClose: () => void): void {
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Element
      if (!ref.current?.contains(target) && !target.closest(button)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [ref, button, onClose])
}

/**
 * The room's details, from the ⓘ button in the controls, the same for everyone: how long it's been
 * open, who hosts it, and the address to give people on a VPN. The host changes the room from the
 * cog next to it (RoomSettings).
 */
export function RoomInfo({
  room,
  hosted,
  endpoint,
  rttMs,
  onToast,
  onClose
}: {
  room: RoomState | null
  /** Set when we host this room: its address is one of ours. */
  hosted: HostedRoom | null
  endpoint: RoomEndpoint
  rttMs: number | null
  onToast(message: string, tone?: 'error' | 'info'): void
  onClose(): void
}) {
  const { t } = useT()
  const ref = useRef<HTMLDivElement>(null)
  useClosesOutside(ref, '.room-info-button', onClose)

  const address = hosted
    ? hosted.addresses[0]
      ? `${hosted.addresses[0]}:${hosted.port}`
      : t('access.portOnly', { port: String(hosted.port) })
    : `${endpoint.address}:${endpoint.port}`
  return (
    <div className="room-info" ref={ref} role="dialog" aria-label={t('room.details')}>
      <dl className="room-info-facts">
        <div>
          <dt>{t('info.privacy')}</dt>
          <dd>
            <Icon name={room?.privacy === 'private' ? 'lock' : 'globe'} size={13} />{' '}
            {room?.privacy === 'private' ? t('info.privatePin') : t('common.public')}
          </dd>
        </div>
        {room && (
          <div>
            <dt>{t('info.openFor')}</dt>
            <dd>{formatDuration(Date.now() - room.startedAt)}</dd>
          </div>
        )}
        <div>
          <dt>{t('info.hostedBy')}</dt>
          <dd>{room?.hostName ?? '–'}</dd>
        </div>
        {rttMs !== null && (
          <div>
            <dt>{t('info.roundTrip')}</dt>
            <dd>{t('common.ms', { value: Math.round(rttMs) })}</dd>
          </div>
        )}
        <div>
          <dt>{hosted ? t('access.address') : t('info.address')}</dt>
          <dd>
            <button
              className="link mono small"
              title={
                hosted
                  ? t('access.addressTip', { list: hosted.addresses.map((a) => `${a}:${hosted.port}`).join('\n') })
                  : t('common.copyAddress')
              }
              onClick={() => void window.api.system.copyText(address).then(() => onToast(t('common.addressCopied')))}
            >
              {address} <Icon name="copy" size={12} />
            </button>
          </dd>
        </div>
      </dl>
    </div>
  )
}

/**
 * The host's room settings, from the cog next to ⓘ: who can come in (public, or private with a
 * PIN), whether watchers may draw on streams and chat, and ending the room.
 */
export function RoomSettings({
  room,
  hosted,
  onToast,
  onEndRoom,
  onAllowDrawing,
  onAllowChat,
  onClose
}: {
  room: RoomState | null
  hosted: HostedRoom
  onToast(message: string, tone?: 'error' | 'info'): void
  onEndRoom(): void
  onAllowDrawing(allowed: boolean): void
  onAllowChat(allowed: boolean): void
  onClose(): void
}) {
  const { t } = useT()
  const ref = useRef<HTMLDivElement>(null)
  useClosesOutside(ref, '.room-settings-button', onClose)

  return (
    <div className="room-info room-settings" ref={ref} role="dialog" aria-label={t('room.settings')}>
      <div className="room-settings-head">
        <strong>{t('room.settings')}</strong>
        <span className="muted small">{t('room.settingsHint')}</span>
      </div>
      <AccessPanel hosted={hosted} onToast={onToast} />
      {room?.drawingAllowed !== undefined && (
        <label className="toggle-row">
          <span className="room-settings-text">
            <span>{t('info.allowDrawing')}</span>
            <span className="muted small">{t('info.allowDrawingHint')}</span>
          </span>
          <input type="checkbox" checked={room.drawingAllowed} onChange={(e) => onAllowDrawing(e.target.checked)} />
        </label>
      )}
      <label className="toggle-row">
        <span className="room-settings-text">
          <span>{t('chat.letViewersChat')}</span>
          <span className="muted small">{t('chat.letViewersChatHint')}</span>
        </span>
        <input type="checkbox" checked={!room?.chatMuted} onChange={(e) => onAllowChat(e.target.checked)} />
      </label>
      <button className="btn danger full" onClick={onEndRoom}>
        <Icon name="logout" /> {t('info.endForEveryone')}
      </button>
    </div>
  )
}
