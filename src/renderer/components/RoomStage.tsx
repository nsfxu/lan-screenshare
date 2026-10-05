import { Avatar } from './Avatar'
import { Icon } from './Icon'

/** A stream someone shares (or we share) but that isn't playing here. */
export interface LiveInfo {
  snapshot: string | null
  paused: boolean
  watchers: number
  /** What the button says, e.g. "Watch stream". */
  action: string
  /** The button's accessible name, e.g. "Watch Alice's stream". */
  actionLabel: string
  onAction(): void
}

/**
 * Someone in the room who isn't playing as video here: their picture and name,
 * and when they share, their stream's latest preview with a button to watch it.
 * Double-click puts the tile in focus.
 */
export function PersonTile({
  name,
  color,
  image,
  you,
  reconnecting,
  live,
  focused,
  small,
  onFocus
}: {
  name: string
  color?: string
  image: string | null
  you: boolean
  reconnecting: boolean
  live: LiveInfo | null
  focused: boolean
  small: boolean
  onFocus(): void
}) {
  return (
    <div
      className={`tile person-tile ${live ? 'live' : ''} ${focused ? 'focused' : ''} ${small ? 'small' : ''}`}
      onDoubleClick={onFocus}
    >
      {live?.snapshot && <div className="person-tile-preview" style={{ backgroundImage: `url(${live.snapshot})` }} />}
      <div className="person-tile-body">
        {!live?.snapshot && <Avatar name={name} color={color} image={image} size={small ? 'normal' : 'large'} />}
        {live && !small && (
          <button className="btn person-tile-action" aria-label={live.actionLabel} onClick={live.onAction}>
            <Icon name={you ? 'screen' : 'eye'} size={15} /> {live.action}
          </button>
        )}
      </div>
      <div className="person-tile-name">
        {live && <span className={`live-badge ${live.paused ? 'paused' : ''}`}>{live.paused ? 'Paused' : 'Live'}</span>}
        <span className="person-tile-name-text">{you ? `${name} (you)` : name}</span>
        {reconnecting && <span className="person-tile-note">reconnecting…</span>}
        {live && !small && (
          <span className="person-tile-note">{live.watchers === 0 ? 'no one watching' : `${live.watchers} watching`}</span>
        )}
      </div>
    </div>
  )
}

/** Shown next to your own tile while you're alone: how others can join. */
export function InviteTile({ address, onCopy }: { address: string | null; onCopy(): void }) {
  return (
    <div className="tile person-tile invite-tile">
      <div className="person-tile-body">
        <Icon name="users" size={28} />
        <strong>Invite people</strong>
        <span className="muted small">
          People on your network see this room in their list. On a VPN, they can use Connect by IP:
        </span>
        {address && (
          <button className="btn small" onClick={onCopy} title="Copy address">
            <span className="mono">{address}</span> <Icon name="copy" size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
