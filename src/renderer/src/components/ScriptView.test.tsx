import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScriptView } from './ScriptView'
import type { TimelineItem, TranscriptSegment } from '../api/projectClient'

function clip(id: string, start: number, duration = 450): TimelineItem {
  return { id, kind: 'video', start, duration, data: { src: `/${id}.mp4` } }
}

function segment(over: Partial<TranscriptSegment> & { timelineItemId: string }): TranscriptSegment {
  return { id: `s-${over.timelineItemId}`, text: '', status: 'edited', ...over }
}

const noop = (): void => undefined

function view(timeline: TimelineItem[], segments: TranscriptSegment[], props = {}): void {
  render(
    <ScriptView
      timeline={timeline}
      segments={segments}
      activeItemId={null}
      draftingItemId={null}
      narratingItemId={null}
      onSeek={noop}
      onSelectItem={noop}
      onCommit={noop}
      onDraft={noop}
      onNarrate={noop}
      {...props}
    />
  )
}

describe('writing the whole script in one place', () => {
  it('shows every clip, so the narration can be read as one piece', () => {
    // Most of what is wrong with narration is only wrong in context — two scenes saying the
    // same thing, or a third that does not follow from the second.
    view(
      [clip('a', 0), clip('b', 450)],
      [
        segment({ timelineItemId: 'a', text: 'Here is the watchlist.' }),
        segment({ timelineItemId: 'b', text: 'And the analysis.' })
      ]
    )

    expect(screen.getByLabelText('Narration for clip 1')).toHaveValue('Here is the watchlist.')
    expect(screen.getByLabelText('Narration for clip 2')).toHaveValue('And the analysis.')
  })

  it('writes the timings into the words, where they can be edited', () => {
    // The timings belong to the words, so they are edited with them rather than through some
    // control beside them — and this is the same shape parseBeats reads back.
    view(
      [clip('a', 0)],
      [
        segment({
          timelineItemId: 'a',
          text: 'One. Two.',
          beats: [
            { at: 0, text: 'One.' },
            { at: 8.5, text: 'Two.' }
          ]
        })
      ]
    )

    expect(screen.getByLabelText('Narration for clip 1')).toHaveValue('[0.0] One.\n[8.5] Two.')
  })

  it('hands back exactly what was typed, timings and all', async () => {
    const onCommit = vi.fn()
    view([clip('a', 0)], [segment({ timelineItemId: 'a', text: 'Old words.' })], { onCommit })

    // Pasted rather than typed: user-event reads a bare "[" as a key descriptor, and the
    // square brackets are the whole point of the format being tested.
    const box = screen.getByLabelText('Narration for clip 1')
    await userEvent.clear(box)
    await userEvent.click(box)
    await userEvent.paste('[2.0] New words.')
    await userEvent.tab()

    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), '[2.0] New words.')
  })

  it('says where each clip has got to, and whether its take is timed', () => {
    view(
      [clip('a', 0), clip('b', 450)],
      [
        segment({
          timelineItemId: 'a',
          text: 'One.',
          status: 'narrated',
          beats: [{ at: 0, text: 'One.' }]
        }),
        segment({ timelineItemId: 'b', text: 'Two.', status: 'draft' })
      ]
    )

    expect(screen.getByText('Voiced · 1 timed lines')).toBeInTheDocument()
    expect(screen.getByText('Drafted · untimed')).toBeInTheDocument()
  })

  it('says a clip has nothing said over it rather than showing an empty box', () => {
    view([clip('a', 0)], [])

    expect(screen.getByText('No narration')).toBeInTheDocument()
  })

  it('will not voice words that have not been saved yet', async () => {
    // Narrating what is on screen rather than what is stored would read the old take aloud.
    const onNarrate = vi.fn()
    view([clip('a', 0)], [segment({ timelineItemId: 'a', text: 'Saved.' })], { onNarrate })

    await userEvent.type(screen.getByLabelText('Narration for clip 1'), ' Edited.')

    expect(screen.getByLabelText('Narrate Narration for clip 1')).toBeDisabled()
  })

  it('invites a first draft when the project is empty', () => {
    view([], [])

    expect(screen.getByText(/narration will be written here/i)).toBeInTheDocument()
  })
})
