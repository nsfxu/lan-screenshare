import { AVATAR_MAX_CHARS, AVATAR_SIZE } from '../../shared/constants'

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Longest side kept while cropping: plenty for a 128 px result, even zoomed in. */
const PICTURE_MAX_SIDE = 2048

/** Decode a picture the user chose (first frame of an animation, upright), scaled down if huge. */
export async function loadPicture(file: Blob): Promise<ImageBitmap> {
  let full: ImageBitmap
  try {
    full = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error("That file isn't a picture the app can read. Try a PNG or JPEG.")
  }
  const k = PICTURE_MAX_SIDE / Math.max(full.width, full.height)
  if (k >= 1) return full
  try {
    return await createImageBitmap(full, {
      resizeWidth: Math.max(1, Math.round(full.width * k)),
      resizeHeight: Math.max(1, Math.round(full.height * k)),
      resizeQuality: 'high'
    })
  } finally {
    full.close()
  }
}

/**
 * Make a profile picture from a square of `bitmap` (image pixels): scaled to
 * AVATAR_SIZE px and saved as JPEG, small enough to send to everyone in a room.
 */
export async function renderAvatar(bitmap: ImageBitmap, crop: { x: number; y: number; size: number }): Promise<string> {
  const canvas = new OffscreenCanvas(AVATAR_SIZE, AVATAR_SIZE)
  const ctx = canvas.getContext('2d')!
  // JPEG has no transparency: give transparent pictures a white background, not black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  for (const quality of [0.85, 0.7, 0.5]) {
    const url = await blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality }))
    if (url.length <= AVATAR_MAX_CHARS) return url
  }
  throw new Error('That picture is too detailed to use. Try another one.')
}
