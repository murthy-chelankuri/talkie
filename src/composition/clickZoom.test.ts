import { describe, expect, it } from 'vitest'
import { NO_ZOOM, mergeFocuses, zoomAt } from './clickZoom'

const focus = { frame: 60, x: 0.25, y: 0.5 }

describe('leaning in where something was clicked', () => {
  it('leaves the picture alone when nothing is happening', () => {
    expect(zoomAt(0, [focus])).toEqual(NO_ZOOM)
    expect(zoomAt(300, [focus])).toEqual(NO_ZOOM)
  })

  it('is already there when the click happens', () => {
    // Arriving after the event would show the viewer where to look once it was too late.
    expect(zoomAt(60, [focus]).scale).toBeGreaterThan(1.17)
  })

  it('starts before the click rather than on it', () => {
    expect(zoomAt(54, [focus]).scale).toBeGreaterThan(1)
    expect(zoomAt(54, [focus]).scale).toBeLessThan(1.18)
  })

  it('comes back to the whole picture afterwards', () => {
    expect(zoomAt(60 + 26 + 16, [focus]).scale).toBeCloseTo(1, 2)
  })

  it('scales from where the click landed', () => {
    const zoom = zoomAt(60, [focus])

    expect(zoom.originX).toBe(25)
    expect(zoom.originY).toBe(50)
  })

  it('keeps away from the very edge, where scaling would show a band of nothing', () => {
    const corner = zoomAt(60, [{ frame: 60, x: 0.01, y: 0.99 }])

    expect(corner.originX).toBe(15)
    expect(corner.originY).toBe(85)
  })

  it('moves smoothly rather than in steps', () => {
    const scales = [52, 54, 56, 58, 60].map((frame) => zoomAt(frame, [focus]).scale)

    for (let i = 1; i < scales.length; i += 1) {
      expect(scales[i]).toBeGreaterThanOrEqual(scales[i - 1])
    }
  })

  it('handles a clip with no clicks in it', () => {
    expect(zoomAt(30, [])).toEqual(NO_ZOOM)
  })
})

describe('what counts as one gesture', () => {
  it('treats clicks in quick succession as a single move', () => {
    // Zooming out and straight back in reads as a flinch.
    const merged = mergeFocuses([
      { frame: 30, x: 0.2, y: 0.2 },
      { frame: 36, x: 0.21, y: 0.2 },
      { frame: 44, x: 0.2, y: 0.21 }
    ])

    expect(merged).toHaveLength(1)
  })

  it('keeps clicks that are far enough apart to be separate moments', () => {
    const merged = mergeFocuses([
      { frame: 30, x: 0.2, y: 0.2 },
      { frame: 200, x: 0.7, y: 0.6 }
    ])

    expect(merged).toHaveLength(2)
  })

  it('puts them in order, whatever order they arrive in', () => {
    const merged = mergeFocuses([
      { frame: 300, x: 0.7, y: 0.6 },
      { frame: 30, x: 0.2, y: 0.2 }
    ])

    expect(merged.map((f) => f.frame)).toEqual([30, 300])
  })
})
