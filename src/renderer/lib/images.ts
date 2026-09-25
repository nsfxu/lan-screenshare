import { AVATAR_MAX_CHARS, AVATAR_SIZE } from '../../shared/constants'

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Turn a picture the user chose into a profile picture: centre-cropped to a
 * square, scaled to AVATAR_SIZE px and saved as JPEG, small enough to send to
 * everyone in a room.
 */
export async function makeAvatar(file: Blob): Promise<string> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error("That file isn't a picture the app can read. Try a PNG or JPEG.")
  }
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = new OffscreenCanvas(AVATAR_SIZE, AVATAR_SIZE)
  const ctx = canvas.getContext('2d')!
  // JPEG has no transparency: give transparent pictures a white background, not black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  bitmap.close()
  for (const quality of [0.85, 0.7, 0.5]) {
    const url = await blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality }))
    if (url.length <= AVATAR_MAX_CHARS) return url
  }
  throw new Error('That picture is too detailed to use. Try another one.')
}
