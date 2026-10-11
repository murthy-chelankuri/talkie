import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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

function view(timeline: TimelineItem[], segments: TranscriptSegment[], props = {}) {
  return render(
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
  it('shows every scene, so the narration can be read as one piece', () => {
    // Most of what is wrong with narration is only wrong in context — two scenes saying the
    // same thing, or a third that does not follow from the second.
    view(
      [clip('a', 0), clip('b', 450)],
      [
        segment({ timelineItemId: 'a', text: 'Here is the watchlist.' }),
        segment({ timelineItemId: 'b', text: 'And the analysis.' })
      ]
    )

    expect(screen.getByLabelText('Narration for scene 1')).toHaveValue('Here is the watchlist.')
    expect(screen.getByLabelText('Narration for scene 2')).toHaveValue('And the analysis.')
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

    expect(screen.getByLabelText('Narration for scene 1')).toHaveValue('[0.0] One.\n[8.5] Two.')
  })

  it('hands back exactly what was typed, timings and all', async () => {
    const onCommit = vi.fn()
    view([clip('a', 0)], [segment({ timelineItemId: 'a', text: 'Old words.' })], { onCommit })

    // Pasted rather than typed: user-event reads a bare "[" as a key descriptor, and the
    // square brackets are the whole point of the format being tested.
    const box = screen.getByLabelText('Narration for scene 1')
    await userEvent.clear(box)
    await userEvent.click(box)
    await userEvent.paste('[2.0] New words.')
    await userEvent.tab()

    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), '[2.0] New words.')
  })

  it('says where each scene has got to, and whether its take is timed', () => {
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

    expect(screen.getByText('Voiced, timed to 1 moment')).toBeInTheDocument()
    expect(screen.getByText('Drafted, read straight through')).toBeInTheDocument()
  })

  it('says a scene has nothing said over it rather than showing an empty box', () => {
    view([clip('a', 0)], [])

    expect(screen.getByText('Nothing written')).toBeInTheDocument()
  })

  it('will not voice words that have not been saved yet', async () => {
    // Narrating what is on screen rather than what is stored would read the old take aloud.
    const onNarrate = vi.fn()
    view([clip('a', 0)], [segment({ timelineItemId: 'a', text: 'Saved.' })], { onNarrate })

    await userEvent.type(screen.getByLabelText('Narration for scene 1'), ' Edited.')

    expect(screen.getByRole('button', { name: 'Voice Narration for scene 1' })).toBeDisabled()
  })

  it('invites a first draft when the project is empty', () => {
    view([], [])

    expect(screen.getByText(/what you say over it is written here/i)).toBeInTheDocument()
  })
})

describe('the script as a piece of paper', () => {
  it('says how much there is to read before any of it', () => {
    // One line at the top rather than the same meta repeated beside every scene.
    view([clip('a', 0, 450), clip('b', 450, 450)], [])

    expect(screen.getByText('2 scenes over 0:30')).toBeInTheDocument()
  })

  it('counts a single scene as one', () => {
    view([clip('a', 0, 450)], [])

    expect(screen.getByText('1 scene over 0:15')).toBeInTheDocument()
  })

  it('lets you play from a scene without leaving the script', () => {
    // Reading and watching are the same job here: the words only make sense against what is
    // on screen while they are said.
    const onSeek = vi.fn()
    view([clip('a', 0), clip('b', 450)], [], { onSeek })

    screen.getByLabelText('Play from scene 2').click()

    expect(onSeek).toHaveBeenCalledWith(450)
  })
})


describe('what a writer needs beside the words', () => {
  it('keeps Draft and Voice on the page, labelled, rather than behind a hover', () => {
    view([clip('a', 0)], [segment({ timelineItemId: 'a', text: 'Saved.' })])

    expect(screen.getByRole('button', { name: 'Draft Narration for scene 1' })).toHaveTextContent('Draft')
    expect(screen.getByRole('button', { name: 'Voice Narration for scene 1' })).toHaveTextContent('Voice')
  })

  it('heads each scene with what it is and where it falls', () => {
    view([clip('a', 0), clip('b', 450)], [])

    const second = screen.getByRole('region', { name: 'Scene 2' })
    expect(within(second).getByText('Recording ·', { exact: false })).toHaveTextContent('Recording · 0:15–0:30')
  })

  it('says roughly how long the words take against how long the clip runs', () => {
    view([clip('a', 0, 450)], [segment({ timelineItemId: 'a', text: 'A few words here.' })])

    expect(screen.getByText(/About 1s to say · clip 15\.0s/)).toBeInTheDocument()
  })

  it('warns when a scene has more words than time, and counts such scenes at the top', () => {
    // Two seconds of clip, a paragraph of words: the voice would run on into the next scene.
    const long = 'word '.repeat(40).trim()
    view([clip('a', 0, 60), clip('b', 60, 450)], [segment({ timelineItemId: 'a', text: long })])

    expect(screen.getByText(/trim the words or lengthen the clip/)).toBeInTheDocument()
    expect(screen.getByText('1 scene has more words than time')).toBeInTheDocument()
  })

  it('draws the timings as chips without changing a character of what is typed', () => {
    view(
      [clip('a', 0)],
      [segment({ timelineItemId: 'a', text: 'One.', beats: [{ at: 2.5, text: 'One.' }] })]
    )

    expect(screen.getByLabelText('Narration for scene 1')).toHaveValue('[2.5] One.')
    const backdrop = screen.getByTestId('script-backdrop')
    expect(backdrop).toHaveTextContent('[2.5] One.')
    expect(within(backdrop).getByText('[2.5]').tagName).toBe('SPAN')
  })
})

describe('keeping what is written', () => {
  it('saves after a pause in typing, not only on leaving the box', async () => {
    const onCommit = vi.fn()
    view([clip('a', 0)], [segment({ timelineItemId: 'a', text: 'Old.' })], { onCommit })

    await userEvent.type(screen.getByLabelText('Narration for scene 1'), ' More.')

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'Old. More.'), {
      timeout: 2500
    })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('does not save the same words twice when the box is left after saving', async () => {
    // Committing twice before the first came back would create two segments for one scene.
    const onCommit = vi.fn()
    view([clip('a', 0)], [segment({ timelineItemId: 'a', text: 'Old.' })], { onCommit })

    await userEvent.type(screen.getByLabelText('Narration for scene 1'), ' More.')
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1), { timeout: 2500 })
    await userEvent.tab()

    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('does not save an emptied scene until the box is left, so its take survives a retype', async () => {
    const onCommit = vi.fn()
    view([clip('a', 0)], [segment({ timelineItemId: 'a', text: 'Old.', status: 'narrated' })], { onCommit })

    await userEvent.clear(screen.getByLabelText('Narration for scene 1'))
    await new Promise((resolve) => setTimeout(resolve, 1200))

    expect(onCommit).not.toHaveBeenCalled()
  })
})

describe('following the video', () => {
  function fakePlayer() {
    const listeners: ((event: { detail: { frame: number } }) => void)[] = []
    return {
      ref: {
        current: {
          getCurrentFrame: () => 0,
          addEventListener: (_: string, listener: (event: { detail: { frame: number } }) => void) => listeners.push(listener),
          removeEventListener: () => undefined
        }
      },
      at: (frame: number) => act(() => listeners.forEach((listener) => listener({ detail: { frame } })))
    }
  }

  it('marks the scene being played and brings it onto the page', () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    const player = fakePlayer()
    view([clip('a', 0), clip('b', 450)], [], { playerRef: player.ref })

    player.at(500)

    expect(screen.getByRole('region', { name: 'Scene 2' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('region', { name: 'Scene 1' })).not.toHaveAttribute('aria-current')
    expect(scrolled).toHaveBeenCalled()
  })

  it('leaves the page where it is while someone is typing', () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    const player = fakePlayer()
    view([clip('a', 0), clip('b', 450)], [], { playerRef: player.ref })

    screen.getByLabelText('Narration for scene 1').focus()
    scrolled.mockClear()
    player.at(500)

    expect(scrolled).not.toHaveBeenCalled()
  })

  it('opens on the scene the video is already in', () => {
    // The script is mounted afresh each time it is switched to, often well into the video.
    const ref = { current: { getCurrentFrame: () => 500, addEventListener: () => undefined, removeEventListener: () => undefined } }
    view([clip('a', 0), clip('b', 450)], [], { playerRef: ref })

    expect(screen.getByRole('region', { name: 'Scene 2' })).toHaveAttribute('aria-current', 'true')
  })
})
