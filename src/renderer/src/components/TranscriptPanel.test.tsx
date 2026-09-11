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
  { id: 'seg-1', text: 'First line', timelineItemId: 'item-1', status: 'narrated' },
  { id: 'seg-2', text: 'Second line', timelineItemId: 'item-2', status: 'edited' }
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

describe('TranscriptPanel', () => {
  beforeEach(() => {
    mockedAdd.mockReset()
    mockedUpdate.mockReset()
    mockedNarrate.mockReset()
    mockedDelete.mockReset()
    mockedUpdate.mockResolvedValue(segments[0])
    mockedAdd.mockResolvedValue({ id: 'seg-3', text: 'Third', timelineItemId: 'item-2', status: 'edited' })
    mockedDelete.mockResolvedValue([])
    mockedNarrate.mockResolvedValue({ ...segments[1], status: 'narrated' })
  })

  it('shows the whole transcript as one editable script', () => {
    renderPanel()
    expect(screen.getByRole('textbox', { name: 'Script' })).toHaveValue('First line\n\nSecond line')
  })

  it('lists each segment with its start time', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /0:00.*First line/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /0:03.*Second line/ })).toBeInTheDocument()
  })

  it('seeks to a segment when its row is clicked', async () => {
    const user = userEvent.setup()
    const onSeek = vi.fn()
    renderPanel({ onSeek })

    await user.click(screen.getByRole('button', { name: /Second line/ }))

    expect(onSeek).toHaveBeenCalledWith(90)
  })

  it('cannot save until the script is edited', async () => {
    const user = userEvent.setup()
    renderPanel()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: 'Script' }), ' more')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('saves an edited paragraph as an update to that segment', async () => {
    const user = userEvent.setup()
    renderPanel()

    const script = screen.getByRole('textbox', { name: 'Script' })
    await user.clear(script)
    await user.type(script, 'First line changed{Enter}{Enter}Second line')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledWith('p1', 'seg-1', 'First line changed'))
    expect(mockedAdd).not.toHaveBeenCalled()
    expect(mockedDelete).not.toHaveBeenCalled()
  })

  it('saves a new paragraph as a segment on the clip of the one before it', async () => {
    const user = userEvent.setup()
    renderPanel()

    const script = screen.getByRole('textbox', { name: 'Script' })
    await user.click(script)
    await user.keyboard('{End}')
    await user.type(script, '{Enter}{Enter}Third line')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockedAdd).toHaveBeenCalledWith('p1', { text: 'Third line', timelineItemId: 'item-2' })
    )
  })

  it('saves a removed paragraph as a deletion', async () => {
    const user = userEvent.setup()
    renderPanel()

    const script = screen.getByRole('textbox', { name: 'Script' })
    await user.clear(script)
    await user.type(script, 'First line')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('p1', 'seg-2'))
  })

  it('narrates only the segments that still need it', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Narrate all (1)' }))

    await waitFor(() => expect(mockedNarrate).toHaveBeenCalledTimes(1))
    expect(mockedNarrate).toHaveBeenCalledWith('p1', 'seg-2')
  })

  it('will not narrate while the script has unsaved edits', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(screen.getByRole('textbox', { name: 'Script' }), ' more')

    expect(screen.getByRole('button', { name: 'Narrate all (1)' })).toBeDisabled()
  })
})
