import { describe, expect, it } from 'vitest'
import { diffScript, parseScript, segmentsToScript } from './scriptDocument'
import type { TranscriptSegment } from '../api/projectClient'

function segment(id: string, text: string, timelineItemId = 'item-1'): TranscriptSegment {
  return { id, text, timelineItemId, status: 'edited' }
}

describe('segmentsToScript', () => {
  it('joins segments into one document separated by blank lines', () => {
    expect(segmentsToScript([segment('a', 'First line'), segment('b', 'Second line')])).toBe(
      'First line\n\nSecond line'
    )
  })

  it('is empty for no segments', () => {
    expect(segmentsToScript([])).toBe('')
  })
})

describe('parseScript', () => {
  it('splits on blank lines', () => {
    expect(parseScript('One\n\nTwo')).toEqual(['One', 'Two'])
  })

  it('keeps single newlines inside a paragraph', () => {
    expect(parseScript('One\nstill one\n\nTwo')).toEqual(['One\nstill one', 'Two'])
  })

  it('ignores blank padding and whitespace-only paragraphs', () => {
    expect(parseScript('\n\n  One  \n\n   \n\nTwo\n\n')).toEqual(['One', 'Two'])
  })

  it('returns nothing for an empty document', () => {
    expect(parseScript('   \n\n  ')).toEqual([])
  })
})

describe('diffScript', () => {
  it('reports nothing when the script is unchanged', () => {
    const segments = [segment('a', 'One'), segment('b', 'Two')]
    expect(diffScript(segments, ['One', 'Two'], 'item-1')).toEqual({
      updates: [],
      additions: [],
      deletions: []
    })
  })

  it('reports an edited paragraph as an update', () => {
    const segments = [segment('a', 'One'), segment('b', 'Two')]
    expect(diffScript(segments, ['One changed', 'Two'], 'item-1').updates).toEqual([
      { id: 'a', text: 'One changed' }
    ])
  })

  it('attaches a new paragraph to the clip of the paragraph before it', () => {
    const segments = [segment('a', 'One', 'item-1'), segment('b', 'Two', 'item-2')]
    expect(diffScript(segments, ['One', 'Two', 'Three'], 'item-1').additions).toEqual([
      { text: 'Three', timelineItemId: 'item-2' }
    ])
  })

  it('uses the fallback clip when the script starts empty', () => {
    expect(diffScript([], ['First ever line'], 'item-9').additions).toEqual([
      { text: 'First ever line', timelineItemId: 'item-9' }
    ])
  })

  it('adds nothing when there is no clip to attach to', () => {
    expect(diffScript([], ['Orphan line'], null).additions).toEqual([])
  })

  it('reports removed paragraphs as deletions', () => {
    const segments = [segment('a', 'One'), segment('b', 'Two'), segment('c', 'Three')]
    expect(diffScript(segments, ['One'], 'item-1').deletions).toEqual(['b', 'c'])
  })

  it('handles a wholly rewritten script', () => {
    const segments = [segment('a', 'One'), segment('b', 'Two')]
    const changes = diffScript(segments, ['Completely new'], 'item-1')
    expect(changes.updates).toEqual([{ id: 'a', text: 'Completely new' }])
    expect(changes.deletions).toEqual(['b'])
  })
})
