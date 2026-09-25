import { AVATAR_MAX_CHARS, SNAPSHOT_MAX_CHARS } from './constants'

const SNAPSHOT_PATTERN = /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const AVATAR_PATTERN = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+={0,2}$/

/** A stream preview: a size-capped JPEG/WebP data URL. */
export function isSnapshot(image: unknown): image is string {
  return typeof image === 'string' && image.length <= SNAPSHOT_MAX_CHARS && SNAPSHOT_PATTERN.test(image)
}

/** A profile picture: a size-capped JPEG/WebP/PNG data URL. */
export function isAvatar(image: unknown): image is string {
  return typeof image === 'string' && image.length <= AVATAR_MAX_CHARS && AVATAR_PATTERN.test(image)
}
