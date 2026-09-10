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
    narrate: vi.fn()
  }
}))

const mockedAddSegment = vi.mocked(transcriptClient.addSegment)
const mockedNarrate = vi.mocked(transcriptClient.narrate)

const timeline: TimelineItem[] = [{ id: 'item-1', kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }]
const segment: TranscriptSegment = {
  id: 'seg-1',
  text: 'Hello there',
  timelineItemId: 'item-1',
  status: 'edited'
}

function renderPanel(props: Partial<Parameters<typeof TranscriptPanel>[0]> = {}) {
  return render(
    <TranscriptPanel
      projectId="p1"
      timeline={timeline}
      segments={[segment]}
      selectedSegmentId={segment.id}
      onSegmentsChange={vi.fn()}
      onSelectSegment={vi.fn()}
      onTimelineChange={vi.fn()}
      {...props}
    />
  )
}

describe('TranscriptPanel', () => {
  beforeEach(() => {
    mockedAddSegment.mockReset()
    mockedNarrate.mockReset()
  })

  it('edits the selected segment rather than listing every segment', () => {
    renderPanel()
    expect(screen.getByDisplayValue('Hello there')).toBeInTheDocument()
  })

  it('points at the timeline when no segment is selected', () => {
    renderPanel({ selectedSegmentId: null })
    expect(screen.getByText('No segment selected')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Hello there')).not.toBeInTheDocument()
  })

  it('disables Add Segment while the form is blank', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Add Segment' })).toBeDisabled()
  })

  it('disables Add Segment while a submission is in flight', async () => {
    const user = userEvent.setup()
    let resolveAdd: ((added: TranscriptSegment) => void) | undefined
    mockedAddSegment.mockReturnValue(new Promise((resolve) => (resolveAdd = resolve)))

    renderPanel()

    await user.selectOptions(screen.getByRole('combobox'), 'item-1')
    await user.type(screen.getByPlaceholderText('New segment text'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Add Segment' }))

    expect(screen.getByRole('button', { name: 'Add Segment' })).toBeDisabled()

    resolveAdd?.({ id: 'seg-2', text: 'Hi', timelineItemId: 'item-1', status: 'edited' })
    await waitFor(() => expect(mockedAddSegment).toHaveBeenCalledTimes(1))
  })

  it('disables Narrate while the selected segment is narrating', async () => {
    const user = userEvent.setup()
    let resolveNarrate: ((updated: TranscriptSegment) => void) | undefined
    mockedNarrate.mockReturnValue(new Promise((resolve) => (resolveNarrate = resolve)))

    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Narrate' }))
    expect(screen.getByRole('button', { name: 'Narrating' })).toBeDisabled()

    resolveNarrate?.({ ...segment, status: 'narrated', audioFile: '/a.wav' })
    await waitFor(() => expect(mockedNarrate).toHaveBeenCalledTimes(1))
  })

  it('reports the new segment so the timeline can pick it up', async () => {
    const user = userEvent.setup()
    const onSegmentsChange = vi.fn()
    mockedAddSegment.mockResolvedValue({
      id: 'seg-2',
      text: 'Hi',
      timelineItemId: 'item-1',
      status: 'edited'
    })

    renderPanel({ onSegmentsChange })

    await user.selectOptions(screen.getByRole('combobox'), 'item-1')
    await user.type(screen.getByPlaceholderText('New segment text'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Add Segment' }))

    await waitFor(() => expect(onSegmentsChange).toHaveBeenCalled())
  })
})
