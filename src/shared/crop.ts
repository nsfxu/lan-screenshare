/**
 * Square crop of an image shown in a square viewport, as used by the profile
 * picture cropper. The image is scaled to at least cover the viewport
 * (`zoom` 1 = just covers it) and positioned by `offset`, the image's
 * top-left corner in viewport pixels. Pure, so it can be unit tested.
 */

export interface CropView {
  /** Viewport side in pixels. */
  view: number
  imageWidth: number
  imageHeight: number
}

export interface Point {
  x: number
  y: number
}

export const MIN_CROP_ZOOM = 1
export const MAX_CROP_ZOOM = 5

/** Image pixels → viewport pixels at this zoom. */
export function cropScale(v: CropView, zoom: number): number {
  return (v.view / Math.min(v.imageWidth, v.imageHeight)) * zoom
}

/** Keep the image covering the whole viewport (no empty edges). */
export function clampOffset(v: CropView, zoom: number, offset: Point): Point {
  const scale = cropScale(v, zoom)
  const minX = v.view - v.imageWidth * scale
  const minY = v.view - v.imageHeight * scale
  return { x: Math.min(0, Math.max(minX, offset.x)), y: Math.min(0, Math.max(minY, offset.y)) }
}

/** The starting position: zoom 1, centred. */
export function centredOffset(v: CropView): Point {
  const scale = cropScale(v, 1)
  return { x: (v.view - v.imageWidth * scale) / 2, y: (v.view - v.imageHeight * scale) / 2 }
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_CROP_ZOOM, Math.max(MIN_CROP_ZOOM, zoom))
}

/** Zoom to `toZoom` (clamped), keeping the image point under `anchor` (viewport pixels) in place. */
export function zoomAt(v: CropView, fromZoom: number, toZoom: number, offset: Point, anchor: Point): Point {
  const zoom = clampZoom(toZoom)
  const ratio = zoom / fromZoom
  return clampOffset(v, zoom, {
    x: anchor.x - (anchor.x - offset.x) * ratio,
    y: anchor.y - (anchor.y - offset.y) * ratio
  })
}

/** The square of the image (in image pixels) that the viewport shows. */
export function cropRect(v: CropView, zoom: number, offset: Point): { x: number; y: number; size: number } {
  const scale = cropScale(v, zoom)
  // 0 - … rather than -…: an edge at 0 gives +0, not -0.
  return { x: 0 - offset.x / scale, y: 0 - offset.y / scale, size: v.view / scale }
}
