import type { RoomEndpoint } from './types'

/** How many rooms the sidebar remembers under "Recent rooms". */
export const RECENT_ROOMS_MAX = 5

export function sameEndpoint(a: Pick<RoomEndpoint, 'address' | 'port'>, b: Pick<RoomEndpoint, 'address' | 'port'>): boolean {
  return a.address === b.address && a.port === b.port
}

/** `list` with `room` moved (or added) to the front, newest first, without duplicates. */
export function pushRecentRoom(list: readonly RoomEndpoint[], room: RoomEndpoint): RoomEndpoint[] {
  return [room, ...list.filter((r) => !sameEndpoint(r, room))].slice(0, RECENT_ROOMS_MAX)
}
