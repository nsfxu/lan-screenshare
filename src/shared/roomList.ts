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

/**
 * One entry per room: the same room can answer on several addresses (found on
 * the LAN, added by IP, over a VPN). Keeps the one that answers, then the one
 * heard from last. Entries without an id (not probed yet) are kept as they are.
 */
export function onePerRoom<T extends { id: string; reachable: boolean; lastSeen: number }>(rooms: readonly T[]): T[] {
  const best = new Map<string, T>()
  for (const r of rooms) {
    if (!r.id) continue
    const other = best.get(r.id)
    const better = !other || (r.reachable !== other.reachable ? r.reachable : r.lastSeen > other.lastSeen)
    if (better) best.set(r.id, r)
  }
  return rooms.filter((r) => !r.id || best.get(r.id) === r)
}
