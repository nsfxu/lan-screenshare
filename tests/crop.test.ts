import { describe, expect, it } from 'vitest'
import { centredOffset, clampOffset, cropRect, cropScale, MAX_CROP_ZOOM, zoomAt } from '../src/shared/crop'

// A 2000x1000 landscape picture in a 250 px viewport: at zoom 1 it is shown 500x250.
const v = { view: 250, imageWidth: 2000, imageHeight: 1000 }

describe('profile picture crop', () => {
  it('starts centred, covering the viewport, cropping the middle square', () => {
    expect(cropScale(v, 1)).toBe(0.25)
    const start = centredOffset(v)
    expect(start).toEqual({ x: -125, y: 0 })
    expect(cropRect(v, 1, start)).toEqual({ x: 500, y: 0, size: 1000 })
  })

  it('never leaves empty edges when dragged too far', () => {
    expect(clampOffset(v, 1, { x: 50, y: 30 })).toEqual({ x: 0, y: 0 })
    expect(clampOffset(v, 1, { x: -900, y: -40 })).toEqual({ x: -250, y: 0 })
    // Left edge and right edge of the picture.
    expect(cropRect(v, 1, clampOffset(v, 1, { x: 999, y: 0 }))).toEqual({ x: 0, y: 0, size: 1000 })
    expect(cropRect(v, 1, clampOffset(v, 1, { x: -999, y: 0 }))).toEqual({ x: 1000, y: 0, size: 1000 })
  })

  it('zooms around the pointer and stays within limits', () => {
    const start = centredOffset(v)
    // Zooming 2x on the viewport centre keeps the same centre and halves the crop.
    const zoomed = zoomAt(v, 1, 2, start, { x: 125, y: 125 })
    expect(cropRect(v, 2, zoomed)).toEqual({ x: 750, y: 250, size: 500 })
    // Zooming on the top-left corner keeps that corner.
    const corner = zoomAt(v, 1, 2, { x: 0, y: 0 }, { x: 0, y: 0 })
    expect(cropRect(v, 2, corner)).toEqual({ x: 0, y: 0, size: 500 })
    // Zooming out past 1 or in past the maximum is capped, and re-clamped.
    expect(zoomAt(v, 2, 0.2, zoomed, { x: 0, y: 0 })).toEqual(zoomAt(v, 2, 1, zoomed, { x: 0, y: 0 }))
    expect(zoomAt(v, 2, 1, zoomed, { x: 0, y: 0 })).toEqual({ x: -187.5, y: 0 })
    expect(cropRect(v, MAX_CROP_ZOOM, zoomAt(v, 1, 99, start, { x: 125, y: 125 })).size).toBe(200)
  })
})
