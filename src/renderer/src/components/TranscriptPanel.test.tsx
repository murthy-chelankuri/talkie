import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranscriptPanel } from './TranscriptPanel'
import { transcriptClient, type TimelineItem, type TranscriptSegment } from '../api/projectClient'

vi.mock('../api/projectClient', () => ({
  transcriptClient: {
    read: vi.fn(),
    addSegment: vi.fn(),
    updateText: vi.fn(),
    narrate: vi.fn(),
    deleteSegment: vi.fn()
  }
}))

const mockedAdd = vi.mocked(transcriptClient.addSegment)
const mockedUpdate = vi.mocked(transcriptClient.updateText)
const mockedNarrate = vi.mocked(transcriptClient.narrate)
const mockedDelete = vi.mocked(transcriptClient.deleteSegment)

const timeline: TimelineItem[] = [
  { id: 'item-1', kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } },
  { id: 'item-2', kind: 'video', start: 90, duration: 300, data: { src: '/v.mp4' } }
]
const segments: TranscriptSegment[] = [
  { id: 'seg-1', text: 'Narration for the image', timelineItemId: 'item-1', status: 'narrated' }
]

function renderPanel(props: Partial<Parameters<typeof TranscriptPanel>[0]> = {}) {
  return render(
    <TranscriptPanel
      projectId="p1"
      timeline={timeline}
      segments={segments}
      activeItemId={null}
      onSegmentsChange={vi.fn()}
      onTimelineChange={vi.fn()}
      onSeek={vi.fn()}
      {...props}
    />
  )
}

const imageBox = () => screen.getByRole('textbox', { name: 'Narration for image at 0:00' })
const videoBox = () => screen.getByRole('textbox', { name: 'Narration for video at 0:03' })

describe('TranscriptPanel', () => {
  beforeEach(() => {
    mockedAdd.mockReset()
    mockedUpdate.mockReset()
    mockedNarrate.mockReset()
    mockedDelete.mockReset()
    mockedAdd.mockResolvedValue({ id: 'seg-2', text: 'x', timelineItemId: 'item-2', status: 'edited' })
    mockedUpdate.mockResolvedValue(segments[0])
    mockedDelete.mockResolvedValue([])
    mockedNarrate.mockResolvedValue({ ...segments[0], status: 'narrated' })
  })

  it('gives every clip its own narration box, in timeline order', () => {
    renderPanel()
    expect(imageBox()).toHaveValue('Narration for the image')
    expect(videoBox()).toHaveValue('')
  })

  it('prompts for narration on a clip that has none', () => {
    renderPanel()
    expect(videoBox()).toHaveAttribute('placeholder', 'Say something about this clip…')
  })

  it('creates narration for a clip by typing into its box', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(videoBox())
    await user.type(videoBox(), 'Now we open the news site')
    await user.tab()

    await waitFor(() =>
      expect(mockedAdd).toHaveBeenCalledWith('p1', {
        text: 'Now we open the news site',
        timelineItemId: 'item-2'
      })
    )
  })

  it('updates narration in place without a save step', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.clear(imageBox())
    await user.type(imageBox(), 'Rewritten narration')
    await user.tab()

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledWith('p1', 'seg-1', 'Rewritten narration'))
  })

  it('removes the narration when its box is emptied', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.clear(imageBox())
    await user.tab()

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('p1', 'seg-1'))
  })

  it('writes nothing when the text is untouched', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(imageBox())
    await user.tab()

    expect(mockedUpdate).not.toHaveBeenCalled()
    expect(mockedAdd).not.toHaveBeenCalled()
    expect(mockedDelete).not.toHaveBeenCalled()
  })

  it('seeks to a clip when its timecode is clicked', async () => {
    const user = userEvent.setup()
    const onSeek = vi.fn()
    renderPanel({ onSeek })

    await user.click(screen.getByRole('button', { name: /0:03\s*video/ }))

    expect(onSeek).toHaveBeenCalledWith(90)
  })

  it('narrates a single clip', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Narrate image' }))

    await waitFor(() => expect(mockedNarrate).toHaveBeenCalledWith('p1', 'seg-1'))
  })

  it('will not narrate a clip whose narration has unsaved edits', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(imageBox(), ' and more')

    expect(screen.getByRole('button', { name: 'Narrate image' })).toBeDisabled()
  })

  it('counts only clips that still need narrating', () => {
    renderPanel({
      segments: [
        segments[0],
        { id: 'seg-2', text: 'Video words', timelineItemId: 'item-2', status: 'edited' }
      ]
    })
    expect(screen.getByRole('button', { name: 'Narrate all (1)' })).toBeEnabled()
  })

  it('has nothing to narrate when every clip is done', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Narrate all (0)' })).toBeDisabled()
  })

  it('explains itself when there are no clips yet', () => {
    renderPanel({ timeline: [] })
    expect(screen.getByText('Nothing to narrate yet')).toBeInTheDocument()
  })
})
