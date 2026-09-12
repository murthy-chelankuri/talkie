import { describe, expect, it } from 'vitest'
import { buildCaptions, splitIntoCues, toSrt, wrapForReading } from './captions'
import { FPS, NARRATION_LEAD_IN_FRAMES } from '../../remotion/constants'
import type { TimelineItem } from '../project/timeline/schema'
import type { TranscriptSegment } from './schema'

function item(id: string, start: number, duration: number): TimelineItem {
  return { id, kind: 'video', start, duration, data: {} } as TimelineItem
}

function segment(itemId: string, overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id: `seg-${itemId}`,
    text: 'This is what happens next.',
    timelineItemId: itemId,
    audioFile: `${itemId}.wav`,
    status: 'narrated',
    ...overrides
  } as TranscriptSegment
}

describe('turning narration into captions', () => {
  it('starts where the words do, not where the clip does', () => {
    // Narration is held back a beat so the picture is seen before it is spoken over.
    const captions = buildCaptions([item('a', 90, 300)], [segment('a')], () => 4)

    expect(captions[0].startFrame).toBe(90 + NARRATION_LEAD_IN_FRAMES)
  })

  it('ends when the take ends', () => {
    const captions = buildCaptions([item('a', 0, 300)], [segment('a')], () => 4)

    expect(captions[0].endFrame).toBe(NARRATION_LEAD_IN_FRAMES + 4 * FPS)
  })

  it('never outlives the clip it belongs to', () => {
    // A caption running past its picture would sit over the next clip.
    const captions = buildCaptions([item('a', 0, 60)], [segment('a')], () => 10)

    expect(captions[0].endFrame).toBe(60)
  })

  it('skips words that have never been spoken', () => {
    // Written but not narrated is not on the soundtrack; a caption for it subtitles silence.
    const written = segment('a', { audioFile: undefined, status: 'edited' })

    expect(buildCaptions([item('a', 0, 300)], [written], () => 4)).toEqual([])
  })

  it('skips a clip with no narration at all', () => {
    expect(buildCaptions([item('a', 0, 300)], [], () => 4)).toEqual([])
  })

  it('skips a take whose length cannot be read', () => {
    expect(buildCaptions([item('a', 0, 300)], [segment('a')], () => undefined)).toEqual([])
  })

  it('follows the clips along the timeline', () => {
    const captions = buildCaptions(
      [item('a', 0, 150), item('b', 150, 150)],
      [segment('a', { text: 'First.' }), segment('b', { text: 'Second.' })],
      () => 2
    )

    expect(captions.map((caption) => caption.text)).toEqual(['First.', 'Second.'])
    expect(captions[1].startFrame).toBe(150 + NARRATION_LEAD_IN_FRAMES)
  })
})

describe('writing SubRip', () => {
  it('numbers the cues from one and times them in hours, minutes, seconds, milliseconds', () => {
    const srt = toSrt([{ startFrame: 30, endFrame: 90, text: 'Hello.' }])

    expect(srt).toContain('1\n')
    expect(srt).toContain('00:00:01,000 --> 00:00:03,000')
    expect(srt).toContain('Hello.')
  })

  it('counts past a minute correctly', () => {
    const srt = toSrt([{ startFrame: 75 * FPS, endFrame: 3700 * FPS, text: 'Long.' }])

    expect(srt).toContain('00:01:15,000 --> 01:01:40,000')
  })

  it('separates cues with a blank line, which is what makes it SubRip', () => {
    const srt = toSrt([
      { startFrame: 0, endFrame: 30, text: 'One.' },
      { startFrame: 60, endFrame: 90, text: 'Two.' }
    ])

    expect(srt).toContain('One.\n\n2\n')
  })
})

describe('breaking a caption for reading', () => {
  it('leaves a short line alone', () => {
    expect(wrapForReading('Short enough.')).toBe('Short enough.')
  })

  it('breaks at a space rather than mid-word', () => {
    const text = 'One pizza, cut four ways. Take three, and the fraction falls out.'
    const wrapped = wrapForReading(text)

    expect(wrapped.split('\n').length).toBe(2)
    // Every word survives whole: the break took a space, not a letter.
    expect(wrapped.split('\n').join(' ')).toBe(text)
  })

  it('never runs to a third line, which would cover the picture', () => {
    const long = 'word '.repeat(60).trim()

    expect(wrapForReading(long).split('\n').length).toBe(2)
  })
})

describe('breaking narration into cues', () => {
  it('leaves a short line as one cue', () => {
    expect(splitIntoCues('Short enough to read at a glance.')).toHaveLength(1)
  })

  it('breaks at sentences, where a reader pauses anyway', () => {
    const cues = splitIntoCues(
      'A brain on a circuit board, lit up in neon. That is the picture everyone paints. Here is what it actually does.'
    )

    expect(cues.length).toBeGreaterThan(1)
    // Short sentences are packed together; every break still lands on the end of one.
    for (const cue of cues.slice(0, -1)) expect(cue).toMatch(/[.!?]$/)
  })

  it('breaks a single long sentence at a word rather than mid-word', () => {
    const long = 'Hover over the tab in the top navigation and a dropdown opens beneath it offering state news and district news as separate choices'
    const cues = splitIntoCues(long)

    expect(cues.length).toBeGreaterThan(1)
    expect(cues.join(' ')).toBe(long)
  })

  it('keeps every cue short enough for two lines', () => {
    const cues = splitIntoCues(
      'A brain sitting on a circuit board, lit up in neon, with the letters A and I glowing beside it. That is the picture everyone paints. Over the next few minutes I will show you what it actually does with it.'
    )

    for (const cue of cues) expect(cue.length).toBeLessThanOrEqual(84)
  })

  it('shares a take’s time out across its cues', () => {
    const captions = buildCaptions(
      [item('a', 0, 600)],
      [
        segment('a', {
          text:
            'First sentence here, with a little more to it. Second sentence follows on from that one. ' +
            'And a third after that, longer again so it cannot possibly fit beside the others.'
        })
      ],
      () => 12
    )

    expect(captions.length).toBeGreaterThan(1)
    // Continuous: each cue starts where the last one ended, and the last ends with the take.
    for (let i = 1; i < captions.length; i += 1) {
      expect(captions[i].startFrame).toBe(captions[i - 1].endFrame)
    }
    expect(captions[captions.length - 1].endFrame).toBe(NARRATION_LEAD_IN_FRAMES + 12 * FPS)
  })
})
