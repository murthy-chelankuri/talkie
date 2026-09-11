import { describe, expect, it } from 'vitest'
import { hasStaleVoice, voiceOf } from './clipNarration'
import type { TranscriptSegment } from '../api/projectClient'

function segment(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id: 'seg-1',
    text: 'Some narration',
    timelineItemId: 'item-1',
    status: 'narrated',
    audioFile: 'seg-1-123.wav',
    voice: 'Samantha',
    ...overrides
  }
}

describe('hasStaleVoice', () => {
  it('spots narration recorded in a voice the user has since changed', () => {
    expect(hasStaleVoice([segment()], 'item-1', 'Daniel')).toBe(true)
  })

  it('leaves narration alone when it matches the chosen voice', () => {
    expect(hasStaleVoice([segment()], 'item-1', 'Samantha')).toBe(false)
  })

  it('treats narration from before voice choice as the voice that build hardcoded', () => {
    // `say -v Samantha` was hardcoded, so a missing voice is not unknown — it is Samantha.
    expect(hasStaleVoice([segment({ voice: undefined })], 'item-1', 'Daniel')).toBe(true)
    expect(hasStaleVoice([segment({ voice: undefined })], 'item-1', 'Samantha')).toBe(false)
  })

  it('ignores narration that was never recorded', () => {
    expect(hasStaleVoice([segment({ status: 'edited', audioFile: undefined })], 'item-1', 'Daniel')).toBe(false)
  })

  it('ignores text with no audio even if it somehow carries a voice', () => {
    expect(hasStaleVoice([segment({ audioFile: undefined })], 'item-1', 'Daniel')).toBe(false)
  })

  it('says nothing about a clip with no narration at all', () => {
    expect(hasStaleVoice([], 'item-1', 'Daniel')).toBe(false)
  })

  it('reports which voice read a clip, so the editor can name it', () => {
    expect(voiceOf([segment({ voice: 'Daniel' })], 'item-1')).toBe('Daniel')
    expect(voiceOf([segment({ voice: undefined })], 'item-1')).toBe('Samantha')
    expect(voiceOf([], 'item-1')).toBeUndefined()
  })
})
