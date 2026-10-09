import { useEffect, useRef } from 'react'
import type { HostedRoom, RoomEndpoint, RoomState } from '../../shared/types'
import { formatDuration } from '../lib/format'
import { useT } from '../lib/i18n'
import { AccessPanel } from './HostControls'
import { Icon } from './Icon'

/**
 * The room's details, from the ⓘ button in the room header: how long it's
 * been open, how to reach it, and for the host its privacy, PIN and End room.
 */
export function RoomInfo({
  room,
  hosted,
  endpoint,
  rttMs,
  onToast,
  onEndRoom,
  onClose
}: {
  room: RoomState | null
  /** Set when we host this room. */
  hosted: HostedRoom | null
  endpoint: RoomEndpoint
  rttMs: number | null
  onToast(message: string, tone?: 'error' | 'info'): void
  onEndRoom(): void
  onClose(): void
}) {
  const { t } = useT()
  const ref = useRef<HTMLDivElement>(null)

  // Closes on a click outside it, or Esc.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Element
      if (!ref.current?.contains(target) && !target.closest('.room-info-button')) onClose()
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
  }, [onClose])

  const address = `${endpoint.address}:${endpoint.port}`
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
        {!hosted && (
          <div>
            <dt>{t('info.address')}</dt>
            <dd>
              <button
                className="link mono small"
                title={t('common.copyAddress')}
                onClick={() => void window.api.system.copyText(address).then(() => onToast(t('common.addressCopied')))}
              >
                {address} <Icon name="copy" size={12} />
              </button>
            </dd>
          </div>
        )}
      </dl>
      {hosted && <AccessPanel hosted={hosted} onToast={onToast} />}
      {hosted && (
        <button className="btn danger full" onClick={onEndRoom}>
          <Icon name="logout" /> {t('info.endForEveryone')}
        </button>
      )}
    </div>
  )
}
