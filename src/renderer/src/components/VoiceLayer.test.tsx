import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VoiceLayer } from './Timeline'
import type { TimelineItem, TranscriptSegment } from '../api/projectClient'

/**
 * Which voice ends up in the video is the question this layer exists to answer, and the one the
 * timeline could not answer before. Every state it can be in is worth pinning.
 */
const item = { id: 'clip-1', kind: 'video', start: 0, duration: 150, data: {} } as TimelineItem

function segment(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id: 'seg-1',
    text: 'Some narration.',
    timelineItemId: 'clip-1',
    audioFile: 'clip-1.aiff',
    voice: 'Samantha',
    status: 'narrated',
    ...overrides
  } as TranscriptSegment
}

function show(segments: TranscriptSegment[], currentVoice = 'Samantha'): void {
  render(<VoiceLayer item={item} segments={segments} currentVoice={currentVoice} compact={false} />)
}

describe('the voice on a clip', () => {
  it('names the voice that read it', () => {
    show([segment()])
    expect(screen.getByText('Samantha')).toBeInTheDocument()
  })

  it('says plainly when the voice is your own', () => {
    show([segment({ voice: 'your own voice' })])
    expect(screen.getByText('Your voice')).toBeInTheDocument()
  })

  it('says a clip has no voice yet', () => {
    show([])
    expect(screen.getByText('No voice')).toBeInTheDocument()
  })

  it('separates written from spoken, which are not the same thing', () => {
    // Words on the clip, but nothing has read them out, so nothing is in the video yet.
    show([segment({ status: 'edited', audioFile: undefined })])
    expect(screen.getByText('Written, not spoken')).toBeInTheDocument()
  })

  it('warns when the audio was read by a voice that is no longer the chosen one', () => {
    show([segment({ voice: 'Daniel' })], 'Samantha')
    expect(screen.getByText('Daniel — voice has changed')).toBeInTheDocument()
  })

  it('leaves a recording of your own alone when the synthesised voice changes', () => {
    // Your own take does not go out of date because a setting moved.
    show([segment({ voice: 'your own voice' })], 'Daniel')
    expect(screen.getByText('Your voice')).toBeInTheDocument()
  })

  it('falls back to the only voice an older project could have used', () => {
    show([segment({ voice: undefined })])
    expect(screen.getByText('Samantha')).toBeInTheDocument()
  })

  it('shows the icon alone when the clip is too narrow for words', () => {
    render(<VoiceLayer item={item} segments={[segment()]} currentVoice="Samantha" compact />)
    expect(screen.queryByText('Samantha')).not.toBeInTheDocument()
    // Still says what it is to anyone hovering or using a screen reader.
    expect(screen.getByTitle('Samantha')).toBeInTheDocument()
  })
})
