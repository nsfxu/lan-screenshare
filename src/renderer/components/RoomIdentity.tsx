import { PROTOCOL_VERSION } from '../../shared/constants'
import type { DiscoveredRoom } from '../../shared/types'
import { incompatibleRoomMessage } from '../../shared/version'
import { useAppVersion } from '../lib/appVersion'
import { initials } from '../lib/format'
import { useT } from '../lib/i18n'
import { Icon } from './Icon'

/**
 * A room's picture in the room list and on the home screen: its host's profile picture, else the
 * host's initials on their colour (hosts before 2.7.0 don't send it), else the room's first letter.
 */
export function RoomAvatar({
  name,
  host,
  live = false,
  locked = false,
  size = 'normal'
}: {
  name: string
  host?: { name: string; color?: string; image?: string | null } | null
  live?: boolean
  locked?: boolean
  size?: 'normal' | 'large'
}) {
  const hostName = host?.name.trim()
  return (
    <span className={`room-avatar ${size === 'large' ? 'large' : ''} ${hostName ? '' : 'plain'}`} style={{ background: host?.color }} aria-hidden="true">
      {host?.image ? (
        <img src={host.image} alt="" draggable={false} />
      ) : hostName ? (
        initials(hostName)
      ) : (
        name.trim().slice(0, 1).toUpperCase()
      )}
      {locked ? (
        <span className="room-avatar-lock">
          <Icon name="lock" size={9} stroke={2.6} />
        </span>
      ) : (
        live && <span className="room-avatar-live" />
      )}
    </span>
  )
}

/** What the room list and the home screen say about a room, and whether it can be joined. */
export interface RoomStatus {
  /** Why it can't be joined because of versions (shown in full in the tooltip). */
  versionProblem: string | null
  full: boolean
  offline: boolean
  people: number
}

export function useRoomStatus(room: DiscoveredRoom | null): RoomStatus {
  const ours = useAppVersion()
  const { t } = useT()
  // Rooms on another protocol answer probes but can't be joined: say who has to update.
  const versionProblem = room ? incompatibleRoomMessage(room, { protocol: PROTOCOL_VERSION, appVersion: ours }, t) : null
  return {
    versionProblem,
    full: !!room && room.maxUsers > 0 && room.viewerCount + 1 >= room.maxUsers,
    offline: !room || (!room.reachable && !versionProblem),
    people: room ? room.viewerCount + 1 : 0
  }
}

/** The line under a room's name: how many are inside, or why it can't be joined (live and private show on its picture). */
export function RoomDetails({ room, status, busy }: { room: DiscoveredRoom; status: RoomStatus; busy: boolean }) {
  const { t } = useT()
  if (busy) return <span className="room-details">{t('rooms.joining')}</span>
  if (status.versionProblem) {
    return (
      <span className="room-details room-row-warn">
        {room.protocol > PROTOCOL_VERSION ? t('rooms.updateToJoin') : t('rooms.olderVersion')}
      </span>
    )
  }
  return <span className="room-details">{status.full ? t('rooms.full') : t('rooms.people', { count: status.people })}</span>
}

/**
 * What a screen reader says for a room's button: the picture's live dot and lock and the host's name
 * aren't text, so they're spelled out here ("Join Alice's room, Live, Private, 2 people").
 */
export function useRoomLabel(): (room: DiscoveredRoom | null, name: string, status: RoomStatus) => string {
  const { t } = useT()
  return (room, name, status) =>
    [
      t('rooms.join', { name }),
      room && !status.offline && room.streams > 0 && t('rooms.liveTag'),
      room && !status.offline && room.privacy === 'private' && t('rooms.privateTag'),
      room && !status.offline && room.hostName && t('rooms.hostedBy', { name: room.hostName }),
      room && !status.offline && !status.versionProblem && t('rooms.people', { count: status.people })
    ]
      .filter(Boolean)
      .join(', ')
}
