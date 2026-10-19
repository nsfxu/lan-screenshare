import { AVATAR_MAX_CHARS, SNAPSHOT_MAX_CHARS } from './constants'

const SNAPSHOT_PATTERN = /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const AVATAR_PATTERN = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+={0,2}$/

/** A stream preview: a size-capped JPEG/WebP data URL. */
export function isSnapshot(image: unknown): image is string {
  return typeof image === 'string' && image.length <= SNAPSHOT_MAX_CHARS && SNAPSHOT_PATTERN.test(image)
}

/** The hash a room's /info gives for its host's picture (see RoomInfo.hostPicture). */
export function isPictureHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value)
}

/** A participant colour as rooms send it: #rrggbb. */
export function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

/** A profile picture: a size-capped JPEG/WebP/PNG data URL. */
export function isAvatar(image: unknown): image is string {
  return typeof image === 'string' && image.length <= AVATAR_MAX_CHARS && AVATAR_PATTERN.test(image)
}
