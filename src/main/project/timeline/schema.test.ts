import { describe, expect, it } from 'vitest'
import { TimelineItemSchema } from './schema'

describe('TimelineItemSchema', () => {
  it('accepts a valid image item', () => {
    const item = {
      id: 'abc123',
      kind: 'image',
      start: 0,
      duration: 90,
      data: { src: '/tmp/photo.png' }
    }

    expect(TimelineItemSchema.parse(item)).toEqual(item)
  })

  it('rejects an unknown kind', () => {
    const item = { id: 'abc123', kind: 'nonexistent-kind', start: 0, duration: 90, data: {} }

    expect(() => TimelineItemSchema.parse(item)).toThrow(/Unknown timeline item kind/)
  })

  it('rejects image data missing src', () => {
    const item = { id: 'abc123', kind: 'image', start: 0, duration: 90, data: {} }

    expect(() => TimelineItemSchema.parse(item)).toThrow(/Invalid data for kind "image"/)
  })

  it('rejects a negative start', () => {
    const item = { id: 'abc123', kind: 'image', start: -1, duration: 90, data: { src: '/tmp/photo.png' } }

    expect(() => TimelineItemSchema.parse(item)).toThrow()
  })

  it('rejects a zero or negative duration', () => {
    const item = { id: 'abc123', kind: 'image', start: 0, duration: 0, data: { src: '/tmp/photo.png' } }

    expect(() => TimelineItemSchema.parse(item)).toThrow()
  })
})
