import { describe, expect, it } from 'vitest'
import { computeTimelineDuration } from './timelineDuration'

describe('computeTimelineDuration', () => {
  it('returns 1 for an empty timeline (Remotion cannot have a zero-length composition)', () => {
    expect(computeTimelineDuration([])).toBe(1)
  })

  it('returns the end frame of the single item', () => {
    expect(computeTimelineDuration([{ id: 'a', kind: 'image', start: 0, duration: 90, data: {} }])).toBe(90)
  })

  it('returns the furthest end frame across overlapping and sequential items', () => {
    const timeline = [
      { id: 'a', kind: 'image', start: 0, duration: 90, data: {} },
      { id: 'b', kind: 'image', start: 30, duration: 30, data: {} }, // ends at 60, inside item a
      { id: 'c', kind: 'image', start: 90, duration: 60, data: {} } // ends at 150, the furthest
    ]

    expect(computeTimelineDuration(timeline)).toBe(150)
  })
})
