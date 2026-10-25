import { NAME_MAX_LENGTH, PEOPLE_LISTED_MAX } from './constants'
import { isColor, isPictureHash } from './images'
import type { RoomPerson } from './types'

/** A room's `people` as /info sent them, checked: anything unexpected is dropped, and a list that isn't one is ignored. */
export function toRoomPeople(value: unknown): RoomPerson[] | undefined {
  if (!Array.isArray(value)) return undefined
  const people: RoomPerson[] = []
  for (const item of value.slice(0, PEOPLE_LISTED_MAX)) {
    if (!item || typeof item !== 'object') continue
    const { name, color, picture } = item as Record<string, unknown>
    if (typeof name !== 'string' || !name.trim() || name.length > NAME_MAX_LENGTH || !isColor(color)) continue
    people.push(isPictureHash(picture) ? { name, color, picture } : { name, color })
  }
  return people
}

/**
 * The faces to show for a room in the list: the first `max` people, and how many more are inside
 * ("+N", counted from the head count, as /info lists at most PEOPLE_LISTED_MAX). Null when there's
 * nobody but the host to show (their picture is already the room's), or no list (private rooms, older hosts).
 */
export function peopleShown(
  people: readonly RoomPerson[] | undefined,
  headCount: number,
  max: number
): { shown: RoomPerson[]; more: number } | null {
  if (!people || people.length < 2 || headCount < 2) return null
  const shown = people.slice(0, max)
  return { shown, more: Math.max(0, headCount - shown.length) }
}
