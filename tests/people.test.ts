import { describe, expect, it } from 'vitest'
import { peopleShown, toRoomPeople } from '../src/shared/people'

const person = (name: string, picture?: string) => ({ name, color: '#4fc3f7', ...(picture && { picture }) })

describe("who's inside a room, in the room list", () => {
  it('keeps only well-formed people from /info', () => {
    expect(toRoomPeople('nope')).toBeUndefined()
    expect(
      toRoomPeople([
        person('Ana', '0123456789abcdef'),
        { name: 'Bob', color: '#4fc3f7', picture: '../etc' },
        { name: 'Eve', color: 'red' },
        { name: '  ', color: '#000000' },
        { name: 'x'.repeat(33), color: '#000000' },
        null,
        42
      ])
    ).toEqual([person('Ana', '0123456789abcdef'), person('Bob')])
    expect(toRoomPeople(Array.from({ length: 20 }, (_, i) => person(`P${i}`)))).toHaveLength(12)
  })

  it('shows the first faces and counts the rest from the head count', () => {
    const people = ['Host', 'A', 'B', 'C', 'D', 'E'].map((n) => person(n))
    expect(peopleShown(people, 6, 4)).toEqual({ shown: people.slice(0, 4), more: 2 })
    expect(peopleShown(people.slice(0, 3), 3, 4)).toEqual({ shown: people.slice(0, 3), more: 0 })
    // /info lists at most 12: the head count says how many more.
    expect(peopleShown(people, 30, 5)?.more).toBe(25)
  })

  it('shows no faces for the host alone, private rooms or older hosts', () => {
    expect(peopleShown([person('Host')], 1, 4)).toBeNull()
    expect(peopleShown(undefined, 4, 4)).toBeNull()
  })
})
