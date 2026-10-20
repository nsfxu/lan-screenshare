import { describe, expect, it } from 'vitest'
import { onePerRoom, pushRecentRoom, RECENT_ROOMS_MAX, roomListRows } from '../src/shared/roomList'

const room = (n: number, name = `Room ${n}`) => ({ address: `10.0.0.${n}`, port: 47800, tls: true, name })

describe('recent rooms', () => {
  it('puts the newest first, without duplicates, keeping the latest name', () => {
    let list = pushRecentRoom([], room(1))
    list = pushRecentRoom(list, room(2))
    list = pushRecentRoom(list, room(1, 'Renamed'))
    expect(list.map((r) => r.name)).toEqual(['Renamed', 'Room 2'])
  })

  it(`remembers at most ${RECENT_ROOMS_MAX}`, () => {
    let list = [] as ReturnType<typeof pushRecentRoom>
    for (let n = 1; n <= 8; n++) list = pushRecentRoom(list, room(n))
    expect(list.map((r) => r.address)).toEqual(['10.0.0.8', '10.0.0.7', '10.0.0.6', '10.0.0.5', '10.0.0.4'])
  })
})

describe('one row per room', () => {
  it('keeps the address that answers, then the freshest, and rooms not probed yet', () => {
    const lan = { key: 'lan', id: 'r1', reachable: false, lastSeen: 300 }
    const byIp = { key: 'ip', id: 'r1', reachable: true, lastSeen: 100 }
    const vpn = { key: 'vpn', id: 'r1', reachable: true, lastSeen: 200 }
    const other = { key: 'x', id: 'r2', reachable: true, lastSeen: 1 }
    const unknown = { key: 'u', id: '', reachable: false, lastSeen: 1 }
    expect(onePerRoom([lan, byIp, vpn, other, unknown]).map((r) => r.key)).toEqual(['vpn', 'x', 'u'])
  })
})

describe('room list groups', () => {
  const found = (n: number, id: string, reachable = true) => ({
    key: `10.0.0.${n}:47800`,
    id,
    name: `Room ${n}`,
    address: `10.0.0.${n}`,
    port: 47800,
    tls: true,
    reachable,
    lastSeen: n
  })
  const offline = (row: { room: { reachable: boolean } | null }): boolean => !row.room?.reachable

  it('splits remembered rooms by whether they answer, and lists the others once', () => {
    const recent = [room(1, 'Game night'), room(2, 'Office'), room(3)]
    const rooms = [found(1, 'a'), found(3, 'c', false), found(4, 'd'), found(5, 'a'), found(6, 'e')]
    const groups = roomListRows(recent, rooms, 'e', offline)
    // Room 1's other address (5) isn't repeated; the room you're in (e) is shown as current, not here.
    expect(groups.recent.map((r) => r.name)).toEqual(['Room 1'])
    expect(groups.offline.map((r) => r.name)).toEqual(['Office', 'Room 3'])
    expect(groups.offline[0].room).toBeNull()
    expect(groups.network.map((r) => r.key)).toEqual(['10.0.0.4:47800'])
  })

  it('keeps the remembered name, then the address, for a room that never answered', () => {
    const groups = roomListRows([{ address: '10.0.0.9', port: 1, tls: false }, room(8, 'Movies')], [], null, offline)
    expect(groups.offline.map((r) => r.name)).toEqual(['10.0.0.9:1', 'Movies'])
  })
})
