import { describe, expect, it } from 'vitest'
import { TranscriptSegmentSchema } from './schema'

describe('TranscriptSegmentSchema', () => {
  it('accepts a valid segment without audioFile', () => {
    const segment = { id: 'abc123', text: 'Now we click Add to Cart', timelineItemId: 'item1', status: 'edited' }

    expect(TranscriptSegmentSchema.parse(segment)).toEqual(segment)
  })

  it('accepts a valid narrated segment with audioFile', () => {
    const segment = {
      id: 'abc123',
      text: 'The cart updates instantly',
      timelineItemId: 'item1',
      audioFile: 'abc123.wav',
      status: 'narrated'
    }

    expect(TranscriptSegmentSchema.parse(segment)).toEqual(segment)
  })

  it('rejects an invalid status', () => {
    const segment = { id: 'abc123', text: 'hello', timelineItemId: 'item1', status: 'published' }

    expect(() => TranscriptSegmentSchema.parse(segment)).toThrow()
  })

  it('rejects a missing timelineItemId', () => {
    const segment = { id: 'abc123', text: 'hello', status: 'edited' }

    expect(() => TranscriptSegmentSchema.parse(segment)).toThrow()
  })
})
