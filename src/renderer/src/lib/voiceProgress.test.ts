import { describe, expect, it } from 'vitest'
import { speakAllLabel, voiceProgress, voiceProgressHint } from './voiceProgress'
import type { TimelineItem, TranscriptSegment } from '../api/projectClient'

/**
 * These counts were one number, and it said a finished project needed fifty-two clips voiced
 * and told the user to write words they had already written. Having no voice and having a
 * different voice are different situations, and the difference is what is tested here.
 */
function clips(count: number): TimelineItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `clip-${index}`,
    kind: 'image',
    start: index * 90,
    duration: 90,
    data: {}
  })) as TimelineItem[]
}

function segment(index: number, overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id: `seg-${index}`,
    text: 'Some words.',
    timelineItemId: `clip-${index}`,
    audioFile: `seg-${index}.wav`,
    voice: 'Samantha',
    status: 'narrated',
    ...overrides
  } as TranscriptSegment
}

describe('what is left to voice', () => {
  it('counts a take read by another voice as voiced, because it plays', () => {
    const timeline = clips(3)
    const segments = timeline.map((_, index) => segment(index, { voice: 'Rishi' }))

    const progress = voiceProgress(timeline, segments, 'Samantha')

    expect(progress.voiced).toBe(3)
    expect(progress.silent).toHaveLength(0)
    expect(progress.otherVoice).toHaveLength(3)
  })

  it('still offers to speak those again, since the voice is now a different one', () => {
    const timeline = clips(2)
    const segments = timeline.map((_, index) => segment(index, { voice: 'Rishi' }))

    expect(voiceProgress(timeline, segments, 'Samantha').needing).toHaveLength(2)
  })

  it('counts a clip with no audio as silent', () => {
    const timeline = clips(2)
    const segments = [segment(0), segment(1, { status: 'edited', audioFile: undefined })]

    const progress = voiceProgress(timeline, segments, 'Samantha')

    expect(progress.voiced).toBe(1)
    expect(progress.silent.map((item) => item.id)).toEqual(['clip-1'])
  })

  it('separates a clip with no words from one that simply has not been spoken', () => {
    const timeline = clips(2)
    const segments = [segment(0, { status: 'draft', audioFile: undefined })]

    const progress = voiceProgress(timeline, segments, 'Samantha')

    expect(progress.silent).toHaveLength(2)
    // Only the second has nothing written on it at all.
    expect(progress.unwritten.map((item) => item.id)).toEqual(['clip-1'])
  })

  it('leaves your own recording alone when the synthesised voice changes', () => {
    const timeline = clips(1)
    const segments = [segment(0, { voice: 'your own voice' })]

    expect(voiceProgress(timeline, segments, 'Daniel').otherVoice).toHaveLength(0)
  })

  it('names the previous voice when they all agree on one', () => {
    const timeline = clips(2)
    const segments = timeline.map((_, index) => segment(index, { voice: 'Rishi' }))

    expect(voiceProgress(timeline, segments, 'Samantha').previousVoice).toBe('Rishi')
  })

  it('names none when the takes disagree', () => {
    const timeline = clips(2)
    const segments = [segment(0, { voice: 'Rishi' }), segment(1, { voice: 'Daniel' })]

    expect(voiceProgress(timeline, segments, 'Samantha').previousVoice).toBeUndefined()
  })
})

describe('what the user is told is left to do', () => {
  const timeline = clips(2)

  it('says nothing when every clip speaks in the chosen voice', () => {
    const segments = timeline.map((_, index) => segment(index))

    expect(voiceProgressHint(voiceProgress(timeline, segments, 'Samantha'), 'Samantha')).toBeNull()
  })

  it('asks for words only when words are what is missing', () => {
    const progress = voiceProgress(timeline, [], 'Samantha')

    expect(voiceProgressHint(progress, 'Samantha')).toContain('Write under a clip')
  })

  it('does not ask for words that are already written', () => {
    const segments = timeline.map((_, index) =>
      segment(index, { status: 'edited', audioFile: undefined })
    )

    const hint = voiceProgressHint(voiceProgress(timeline, segments, 'Samantha'), 'Samantha')

    expect(hint).toContain('written but not spoken')
    expect(hint).not.toContain('Write under a clip')
  })

  it('describes another voice as a choice rather than something missing', () => {
    const segments = timeline.map((_, index) => segment(index, { voice: 'Rishi' }))

    const hint = voiceProgressHint(voiceProgress(timeline, segments, 'Samantha'), 'Samantha')

    expect(hint).toContain('read by Rishi, not Samantha')
    expect(hint).not.toContain('need')
  })
})

describe('the label on the button that speaks everything', () => {
  const timeline = clips(2)

  it('offers to speak the clips that have words but no voice', () => {
    const segments = timeline.map((_, index) => segment(index, { status: 'edited', audioFile: undefined }))

    expect(speakAllLabel(voiceProgress(timeline, segments, 'Samantha'), 'Samantha')).toBe('Speak 2 clips')
  })

  it('does not offer to speak a clip with no words, which it cannot do', () => {
    // An HTML scene arrives with no narration. Counting it offered "Speak 1 clip", and pressing
    // that did nothing at all.
    const progress = voiceProgress(timeline, [segment(0)], 'Samantha')

    expect(progress.needing).toHaveLength(0)
    expect(speakAllLabel(progress, 'Samantha')).toBe('1 clip needs words')
  })

  it('speaks the written clips and leaves the unwritten one out', () => {
    const three = clips(3)
    const segments = [segment(0), segment(1, { status: 'edited', audioFile: undefined })]

    const progress = voiceProgress(three, segments, 'Samantha')

    expect(progress.needing.map((item) => item.id)).toEqual(['clip-1'])
    expect(speakAllLabel(progress, 'Samantha')).toBe('Speak 1 clip')
  })

  it('offers to re-speak, naming the voice it would switch to', () => {
    const segments = timeline.map((_, index) => segment(index, { voice: 'Rishi' }))

    expect(speakAllLabel(voiceProgress(timeline, segments, 'Samantha'), 'Samantha')).toBe(
      'Re-speak 2 in Samantha'
    )
  })

  it('says there is nothing to do when there is nothing to do', () => {
    const segments = timeline.map((_, index) => segment(index))

    expect(speakAllLabel(voiceProgress(timeline, segments, 'Samantha'), 'Samantha')).toBe('All voiced')
  })
})
