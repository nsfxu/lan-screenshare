import { Icon } from './Icon'

/** The centre while you're not in a room. */
export function Welcome({ hasRooms, onCreate }: { hasRooms: boolean; onCreate(): void }) {
  return (
    <div className="welcome">
      <div className="welcome-mark">
        <Icon name="screen" size={28} />
      </div>
      <h1>ScreenShare</h1>
      <p className="muted">
        {hasRooms
          ? 'Pick a room on the left to join it, or create your own.'
          : 'No rooms on your network yet. Create one, or use Connect by IP for rooms on a VPN.'}
      </p>
      <button className="btn primary" onClick={onCreate}>
        <Icon name="plus" /> Create room
      </button>
    </div>
  )
}
