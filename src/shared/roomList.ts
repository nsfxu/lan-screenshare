import type { DiscoveredRoom, RecentRoom, RoomEndpoint } from './types'

/** How many rooms the sidebar remembers under "Recent rooms". */
export const RECENT_ROOMS_MAX = 5

export function sameEndpoint(a: Pick<RoomEndpoint, 'address' | 'port'>, b: Pick<RoomEndpoint, 'address' | 'port'>): boolean {
  return a.address === b.address && a.port === b.port
}

/** `list` with `room` moved (or added) to the front, newest first, without duplicates. */
export function pushRecentRoom(list: readonly RecentRoom[], room: RecentRoom): RecentRoom[] {
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

/** One line of the room list: a discovered room, or a remembered one that isn't answering. */
export interface RoomRow<R extends Pick<DiscoveredRoom, 'id' | 'key' | 'name' | 'address' | 'port' | 'tls'>> {
  key: string
  name: string
  room: R | null
  endpoint: RecentRoom
}

/**
 * The room list's groups:
 * - recent: rooms you joined before that answer (newest first), with the one you're in;
 * - offline: rooms you joined before that don't answer right now (`offline` decides);
 * - network: the other rooms found, one row per room even when it answers on several addresses.
 */
export function roomListRows<R extends Pick<DiscoveredRoom, 'id' | 'key' | 'name' | 'address' | 'port' | 'tls' | 'reachable' | 'lastSeen'>>(
  recentRooms: readonly RecentRoom[],
  rooms: readonly R[],
  currentId: string | null,
  offline: (row: RoomRow<R>) => boolean
): { recent: RoomRow<R>[]; offline: RoomRow<R>[]; network: RoomRow<R>[] } {
  const remembered = recentRooms.map((ep): RoomRow<R> => {
    const room = rooms.find((r) => sameEndpoint(r, ep)) ?? null
    return { key: `${ep.address}:${ep.port}`, name: room?.name || ep.name || `${ep.address}:${ep.port}`, room, endpoint: ep }
  })
  const shown = new Set([currentId, ...remembered.map((row) => row.room?.id)].filter(Boolean))
  const network = onePerRoom(rooms)
    .filter((r) => !recentRooms.some((ep) => sameEndpoint(r, ep)) && !(r.id && shown.has(r.id)))
    .map((r): RoomRow<R> => ({ key: r.key, name: r.name, room: r, endpoint: { address: r.address, port: r.port, tls: r.tls, name: r.name } }))
  return {
    recent: remembered.filter((row) => !offline(row)),
    offline: remembered.filter((row) => offline(row)),
    network
  }
}
