import { useCallback, useEffect, useRef, type MouseEvent } from 'react'
import { useT } from '../lib/i18n'
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
  onFocus,
  onContextMenu
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
  onContextMenu?(e: MouseEvent): void
}) {
  const { t } = useT()
  const clickToFocus = useClickToFocus(onFocus)
  return (
    <div
      className={`tile person-tile ${live ? 'live' : ''} ${focused ? 'focused' : ''} ${small ? 'small' : ''}`}
      onClick={clickToFocus}
      onContextMenu={onContextMenu}
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
        {live && <span className={`live-badge ${live.paused ? 'paused' : ''}`}>{live.paused ? t('common.paused') : t('common.live')}</span>}
        <span className="person-tile-name-text">{you ? t('common.you', { name }) : name}</span>
        {reconnecting && <span className="person-tile-note">{t('room.reconnectingNote')}</span>}
        {live && !small && (
          <span className="person-tile-note">
            {live.watchers === 0 ? t('common.noOneWatching') : t('common.watching', { count: live.watchers })}
          </span>
        )}
      </div>
    </div>
  )
}

/** Shown next to your own tile while you're alone: how others can join. */
export function InviteTile({ address, onCopy }: { address: string | null; onCopy(): void }) {
  const { t } = useT()
  return (
    <div className="tile person-tile invite-tile">
      <div className="person-tile-body">
        <Icon name="users" size={28} />
        <strong>{t('room.invite')}</strong>
        <span className="muted small">{t('room.inviteHint')}</span>
        {address && (
          <button className="btn small" onClick={onCopy} title={t('common.copyAddress')}>
            <span className="mono">{address}</span> <Icon name="copy" size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

/** How long a click waits for a second one: a double-click zooms a stream instead of focusing it. */
const DOUBLE_CLICK_MS = 230

/**
 * A click on a tile focuses it (and on the focused one, goes back to the grid).
 * Clicks on its buttons, menus and video controls don't count, nor do double
 * clicks or clicks while `busy()` (a zoomed-in stream is being dragged).
 */
export function useClickToFocus(onFocus: () => void, busy?: () => boolean): (e: MouseEvent) => void {
  const timer = useRef<number | null>(null)
  const focus = useRef(onFocus)
  focus.current = onFocus
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  return useCallback(
    (e: MouseEvent) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      const target = e.target as Element
      if (e.button !== 0 || e.detail > 1 || busy?.()) return
      if (target.closest('button, input, select, a')) return
      timer.current = window.setTimeout(() => {
        timer.current = null
        focus.current()
      }, DOUBLE_CLICK_MS)
    },
    [busy]
  )
}
