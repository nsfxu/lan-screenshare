import { describe, expect, it } from 'vitest'
import { pushRecentRoom, RECENT_ROOMS_MAX } from '../src/shared/recentRooms'

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
