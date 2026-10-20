import { NAME_MAX_LENGTH, ROOM_NAME_MAX_LENGTH } from './constants'
import { isAvatar, isColor } from './images'
import type { DiscoveredRoom, RecentHost, RecentRoom, RoomEndpoint } from './types'

/** How many rooms the sidebar remembers under "Recent rooms", besides the pinned ones. */
export const RECENT_ROOMS_MAX = 5
/** How many rooms can be pinned to the top of the list. */
export const PINNED_ROOMS_MAX = 10

export function sameEndpoint(a: Pick<RoomEndpoint, 'address' | 'port'>, b: Pick<RoomEndpoint, 'address' | 'port'>): boolean {
  return a.address === b.address && a.port === b.port
}

/** The pinned rooms first (as they were pinned), then the others newest first, each group capped. */
export function arrangeRecentRooms(list: readonly RecentRoom[]): RecentRoom[] {
  return [
    ...list.filter((r) => r.pinned).slice(0, PINNED_ROOMS_MAX),
    ...list.filter((r) => !r.pinned).slice(0, RECENT_ROOMS_MAX)
  ]
}

/**
 * `list` with `room` moved (or added) to the front, newest first, without duplicates; a pinned room
 * keeps its place among the pinned. A room joined again keeps what you set on it (pin, name) and the
 * host remembered with it, until rememberHost() has a newer one.
 */
export function pushRecentRoom(list: readonly RecentRoom[], room: RecentRoom): RecentRoom[] {
  const old = list.find((r) => sameEndpoint(r, room))
  const host = room.host ?? old?.host
  const next: RecentRoom = {
    ...room,
    ...(host && { host }),
    ...(old?.pinned && { pinned: true }),
    ...(old?.nickname && { nickname: old.nickname })
  }
  if (old?.pinned) return arrangeRecentRooms(list.map((r) => (r === old ? next : r)))
  return arrangeRecentRooms([next, ...list.filter((r) => r !== old)])
}

/**
 * Pin a room to the top of the list (above the other pinned ones), or unpin it (it becomes the
 * newest of the others). `list` itself when it's not there, or when PINNED_ROOMS_MAX are pinned.
 */
export function pinRecentRoom(
  list: readonly RecentRoom[],
  endpoint: Pick<RoomEndpoint, 'address' | 'port'>,
  pinned: boolean
): readonly RecentRoom[] {
  const room = list.find((r) => sameEndpoint(r, endpoint))
  if (!room || !!room.pinned === pinned) return list
  if (pinned && list.filter((r) => r.pinned).length >= PINNED_ROOMS_MAX) return list
  const others = list.filter((r) => r !== room)
  if (pinned) return arrangeRecentRooms([{ ...room, pinned: true }, ...others])
  const { pinned: _pinned, ...unpinned } = room
  return arrangeRecentRooms([...others.filter((r) => r.pinned), unpinned, ...others.filter((r) => !r.pinned)])
}

/** A name you gave a room, as you typed it or as read from the settings file: undefined for none. */
export function toNickname(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.trim().replace(/\s+/g, ' ').slice(0, ROOM_NAME_MAX_LENGTH)
  return name || undefined
}

/**
 * Give the room at `endpoint` your own name for it; an empty one, or the room's own name, goes back
 * to the room's own name.
 */
export function renameRecentRoom(
  list: readonly RecentRoom[],
  endpoint: Pick<RoomEndpoint, 'address' | 'port'>,
  name: string,
  roomName?: string
): readonly RecentRoom[] {
  const i = list.findIndex((r) => sameEndpoint(r, endpoint))
  if (i < 0) return list
  const nickname = toNickname(name)
  const { nickname: old, ...room } = list[i]
  const next: RecentRoom = nickname && nickname !== (roomName ?? room.name) ? { ...room, nickname } : room
  if (next.nickname === old) return list
  return list.map((r, j) => (j === i ? next : r))
}

/** A remembered host as read from the settings file: anything unexpected is dropped. */
export function toRecentHost(value: unknown): RecentHost | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { name, color, image } = value as Record<string, unknown>
  const trimmed = typeof name === 'string' ? name.trim().slice(0, NAME_MAX_LENGTH) : ''
  if (!trimmed) return undefined
  return { name: trimmed, ...(isColor(color) && { color }), ...(isAvatar(image) && { image }) }
}

/**
 * `list` with the host of the room at `endpoint` set to `host` (as seen inside the room), or `list`
 * itself when nothing changed, so the settings aren't written again for nothing.
 */
export function rememberHost(
  list: readonly RecentRoom[],
  endpoint: Pick<RoomEndpoint, 'address' | 'port'>,
  host: { name: string; color?: string; image?: string | null }
): readonly RecentRoom[] {
  const next = toRecentHost(host)
  const i = list.findIndex((r) => sameEndpoint(r, endpoint))
  if (!next || i < 0) return list
  const old = list[i].host
  if (old?.name === next.name && old.color === next.color && old.image === next.image) return list
  return list.map((r, j) => (j === i ? { ...r, host: next } : r))
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
 * - recent: the pinned rooms (answering or not), then the rooms you joined before that answer
 *   (newest first), with the one you're in;
 * - offline: the other rooms you joined before that don't answer right now (`offline` decides);
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
    return {
      key: `${ep.address}:${ep.port}`,
      name: ep.nickname || room?.name || ep.name || `${ep.address}:${ep.port}`,
      room,
      endpoint: ep
    }
  })
  const shown = new Set([currentId, ...remembered.map((row) => row.room?.id)].filter(Boolean))
  const network = onePerRoom(rooms)
    .filter((r) => !recentRooms.some((ep) => sameEndpoint(r, ep)) && !(r.id && shown.has(r.id)))
    .map((r): RoomRow<R> => ({ key: r.key, name: r.name, room: r, endpoint: { address: r.address, port: r.port, tls: r.tls, name: r.name } }))
  return {
    recent: remembered.filter((row) => row.endpoint.pinned || !offline(row)),
    offline: remembered.filter((row) => !row.endpoint.pinned && offline(row)),
    network
  }
}
