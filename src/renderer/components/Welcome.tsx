import { onePerRoom } from '../../shared/roomList'
import type { DiscoveredRoom } from '../../shared/types'
import { useT } from '../lib/i18n'
import { Icon } from './Icon'
import { RoomAvatar, RoomDetails, useRoomStatus } from './RoomIdentity'

/** The centre while you're not in a room: the rooms you can join, as cards, and making your own. */
export function Welcome({
  rooms,
  busyKey,
  onJoin,
  onCreate
}: {
  rooms: DiscoveredRoom[]
  /** Key (address:port) of the room being joined right now. */
  busyKey: string | null
  onJoin(room: DiscoveredRoom): void
  onCreate(): void
}) {
  const { t } = useT()
  // Rooms that answer, including ones on another version (their card says what to update).
  const answering = onePerRoom(rooms).filter((r) => r.id && (r.reachable || r.protocol !== 0))

  if (answering.length === 0) {
    return (
      <div className="welcome">
        <div className="welcome-mark">
          <Icon name="screen" size={28} />
        </div>
        <h1>ScreenShare</h1>
        <p className="muted">{t('welcome.noRooms')}</p>
        <button className="btn primary" onClick={onCreate}>
          <Icon name="plus" /> {t('common.createRoom')}
        </button>
      </div>
    )
  }

  return (
    <div className="welcome rooms-home">
      <header className="rooms-home-header">
        <h1>{t('welcome.title')}</h1>
        <p className="muted">{t('welcome.subtitle')}</p>
      </header>
      <div className="room-cards">
        {answering.map((room) => (
          <RoomCard key={room.key} room={room} busy={busyKey === room.key} onJoin={() => onJoin(room)} />
        ))}
        <button className="room-card create" onClick={onCreate}>
          <span className="room-card-plus">
            <Icon name="plus" size={20} stroke={2.2} />
          </span>
          <span className="room-card-name">{t('common.createRoom')}</span>
          <span className="muted small">{t('welcome.createCardHint')}</span>
        </button>
      </div>
    </div>
  )
}

function RoomCard({ room, busy, onJoin }: { room: DiscoveredRoom; busy: boolean; onJoin(): void }) {
  const { t } = useT()
  const status = useRoomStatus(room)
  const joinable = !busy && !status.full && !status.versionProblem && !status.offline
  return (
    <div className="room-card" title={status.versionProblem ?? undefined}>
      <RoomAvatar
        name={room.name}
        host={{ name: room.hostName, color: room.hostColor, image: room.hostImage }}
        live={room.streams > 0}
        locked={room.privacy === 'private'}
        size="large"
      />
      <span className="room-card-text">
        <span className="room-card-name">{room.name}</span>
        <RoomDetails room={room} status={status} busy={busy} />
      </span>
      <button
        className={`btn small ${room.privacy === 'private' ? '' : 'primary'}`}
        disabled={!joinable}
        aria-label={t('rooms.join', { name: room.name })}
        onClick={onJoin}
      >
        {t('welcome.join')}
      </button>
    </div>
  )
}
