import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ScriptView } from './ScriptView'
import { narrationFromText } from '../../../main/transcript/narrationBeats'
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
  it('says in words that a scene is being written or voiced, and how long it has taken, and holds its words still meanwhile', () => {
    // A 12px spinner in place of a button's icon was all there was; a scene that sat unchanged
    // for half a minute while a model wrote its words looked frozen.
    vi.useFakeTimers()
    try {
      const { rerender } = view([clip('a', 0)], [segment({ timelineItemId: 'a', text: 'Old words.' })], { draftingItemId: 'a' })
      act(() => void vi.advanceTimersByTime(3200))
      expect(screen.getAllByRole('status').some((each) => /Writing the words… 3s/.test(each.textContent ?? ''))).toBe(true)
      expect(screen.getByRole('button', { name: 'Writing Narration for scene 1' })).toHaveTextContent('Writing…')
      expect(screen.getByLabelText('Narration for scene 1')).toHaveAttribute('readonly')

      rerender(
        <ScriptView
          timeline={[clip('a', 0)]}
          segments={[segment({ timelineItemId: 'a', text: 'Old words.' })]}
          activeItemId={null}
          draftingItemId={null}
          narratingItemId="a"
          onSeek={noop}
          onSelectItem={noop}
          onCommit={noop}
          onDraft={noop}
          onNarrate={noop}
        />
      )
      expect(screen.getByText(/Voicing…/, { selector: 'span' })).toBeInTheDocument()
      expect(screen.getByLabelText('Narration for scene 1')).not.toHaveAttribute('readonly')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps Write and Voice on the page, labelled, rather than behind a hover', () => {
    view([clip('a', 0)], [segment({ timelineItemId: 'a', text: 'Saved.' })])

    expect(screen.getByRole('button', { name: 'Write Narration for scene 1' })).toHaveTextContent('Write')
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

  it('leaves what is being typed exactly as typed when it saves, line breaks and all, with no full stops added', async () => {
    // The words came back from the store tidied — timed lines joined, a full stop on each — and
    // were put back into the box every time the typing paused, so writing narration by hand meant
    // fighting the box: lines vanished and full stops appeared under the cursor.
    function Store(): JSX.Element {
      const [segments, setSegments] = useState<TranscriptSegment[]>([segment({ timelineItemId: 'a', text: 'Old' })])
      return (
        <ScriptView
          timeline={[clip('a', 0)]}
          segments={segments}
          activeItemId={null}
          draftingItemId={null}
          narratingItemId={null}
          onSeek={noop}
          onSelectItem={noop}
          onDraft={noop}
          onNarrate={noop}
          onCommit={(_item, written) => {
            // As the store keeps it: the prose and the timings read out of what was written.
            const { text, beats } = narrationFromText(written)
            setSegments([segment({ timelineItemId: 'a', text, ...(beats.length ? { beats } : {}) })])
          }}
        />
      )
    }
    render(<Store />)
    const box = screen.getByLabelText('Narration for scene 1') as HTMLTextAreaElement

    await userEvent.clear(box)
    await userEvent.type(box, '[[1] Here is the board{Enter}with every task on it{Enter}[[4] Now drag one')
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument(), { timeout: 2500 })
    expect(box.value).toBe('[1] Here is the board\nwith every task on it\n[4] Now drag one')

    // And typing on after the save carries on from where it was, not from a rewritten line.
    await userEvent.type(box, ' across')
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument(), { timeout: 2500 })
    expect(box.value).toBe('[1] Here is the board\nwith every task on it\n[4] Now drag one across')
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

describe('recording a scene in your own voice', () => {
  it('records from the script, not only from the timeline', async () => {
    const onRecord = vi.fn()
    view([clip('a', 0)], [segment({ timelineItemId: 'a', text: 'Words.' })], { onRecord, onStopRecording: vi.fn() })

    await userEvent.click(screen.getByRole('button', { name: 'Record Narration for scene 1 in your own voice' }))

    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  it('offers Stop while recording, and says what to do meanwhile', async () => {
    const onStopRecording = vi.fn()
    view([clip('a', 0)], [segment({ timelineItemId: 'a', text: 'Words.' })], {
      recordingItemId: 'a',
      onRecord: vi.fn(),
      onStopRecording
    })

    expect(screen.getByText(/read the words aloud, then press Stop/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voice Narration for scene 1' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording Narration for scene 1' }))

    expect(onStopRecording).toHaveBeenCalled()
  })

  it('records one scene at a time', () => {
    view([clip('a', 0), clip('b', 450)], [], { recordingItemId: 'a', onRecord: vi.fn(), onStopRecording: vi.fn() })

    expect(screen.getByRole('button', { name: 'Record Narration for scene 2 in your own voice' })).toBeDisabled()
  })
})

describe('dragging a scene larger', () => {
  // jsdom lays nothing out, so every element is 0 wide; give the page a width to grow into.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1400)
  })
  afterEach(() => vi.restoreAllMocks())

  const textOf = (n: number): HTMLElement =>
    within(screen.getByRole('region', { name: `Scene ${n}` })).getByTestId('script-text')

  it('grows that scene’s words from its corner and leaves the rest as they were', async () => {
    view([clip('a', 0), clip('b', 450)], [])

    screen.getByRole('button', { name: 'Resize scene 2' }).focus()
    for (let i = 0; i < 8; i++) await userEvent.keyboard('{ArrowRight}')

    expect(parseFloat(textOf(2).style.fontSize)).toBeGreaterThan(15)
    expect(textOf(1).style.fontSize).toBe('15px')
  })

  it('adds room below the words when the corner goes down', async () => {
    view([clip('a', 0)], [])

    screen.getByRole('button', { name: 'Resize scene 1' }).focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')

    expect(textOf(1).style.paddingBottom).toBe('80px')
  })

  it('goes back to how it was on a double-click', async () => {
    view([clip('a', 0)], [])

    const corner = screen.getByRole('button', { name: 'Resize scene 1' })
    corner.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}')
    await userEvent.dblClick(corner)

    expect(textOf(1).style.fontSize).toBe('15px')
    expect(screen.getByRole('region', { name: 'Scene 1' }).style.width).toBe('640px')
  })
})
