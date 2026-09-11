import { describe, expect, it } from 'vitest'
import { narrationTextForItem, planNarrationCommit, segmentsForItem } from './clipNarration'
import type { TranscriptSegment } from '../api/projectClient'

function segment(id: string, text: string, timelineItemId: string): TranscriptSegment {
  return { id, text, timelineItemId, status: 'edited' }
}

const segments = [
  segment('a', 'Clip one narration', 'item-1'),
  segment('b', 'Clip two narration', 'item-2')
]

describe('segmentsForItem', () => {
  it('returns only the segments belonging to the clip', () => {
    expect(segmentsForItem(segments, 'item-2').map((s) => s.id)).toEqual(['b'])
  })

  it('returns nothing for a clip with no narration', () => {
    expect(segmentsForItem(segments, 'item-3')).toEqual([])
  })
})

describe('narrationTextForItem', () => {
  it('reads the clip narration', () => {
    expect(narrationTextForItem(segments, 'item-1')).toBe('Clip one narration')
  })

  it('is empty for a clip with no narration', () => {
    expect(narrationTextForItem(segments, 'item-3')).toBe('')
  })

  it('folds a legacy clip with several segments into one block of text', () => {
    const legacy = [segment('a', 'First half', 'item-1'), segment('b', 'Second half', 'item-1')]
    expect(narrationTextForItem(legacy, 'item-1')).toBe('First half\n\nSecond half')
  })
})

describe('planNarrationCommit', () => {
  it('does nothing when the text is unchanged', () => {
    expect(planNarrationCommit(segments, 'item-1', 'Clip one narration')).toEqual({ action: 'none' })
  })

  it('ignores surrounding whitespace', () => {
    expect(planNarrationCommit(segments, 'item-1', '  Clip one narration  ')).toEqual({ action: 'none' })
  })

  it('creates narration for a clip that had none', () => {
    expect(planNarrationCommit(segments, 'item-3', 'Brand new')).toEqual({
      action: 'create',
      text: 'Brand new'
    })
  })

  it('does nothing when an empty clip is left empty', () => {
    expect(planNarrationCommit(segments, 'item-3', '   ')).toEqual({ action: 'none' })
  })

  it('updates the existing narration', () => {
    expect(planNarrationCommit(segments, 'item-1', 'Rewritten')).toEqual({
      action: 'update',
      id: 'a',
      text: 'Rewritten',
      removeIds: []
    })
  })

  it('collapses a legacy multi-segment clip onto the first segment', () => {
    const legacy = [segment('a', 'First half', 'item-1'), segment('b', 'Second half', 'item-1')]
    expect(planNarrationCommit(legacy, 'item-1', 'Merged text')).toEqual({
      action: 'update',
      id: 'a',
      text: 'Merged text',
      removeIds: ['b']
    })
  })

  it('deletes the narration when the text is cleared', () => {
    expect(planNarrationCommit(segments, 'item-1', '')).toEqual({
      action: 'delete',
      removeIds: ['a']
    })
  })
})
