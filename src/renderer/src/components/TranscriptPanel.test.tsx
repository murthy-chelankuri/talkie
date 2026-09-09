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

const mockedRead = vi.mocked(transcriptClient.read)
const mockedAddSegment = vi.mocked(transcriptClient.addSegment)
const mockedNarrate = vi.mocked(transcriptClient.narrate)

const timeline: TimelineItem[] = [{ id: 'item-1', kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }]

describe('TranscriptPanel', () => {
  beforeEach(() => {
    mockedRead.mockReset()
    mockedAddSegment.mockReset()
    mockedNarrate.mockReset()
    mockedRead.mockResolvedValue([])
  })

  it('disables Add Segment while the form is blank', async () => {
    render(<TranscriptPanel projectId="p1" timeline={timeline} onTimelineChange={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Add Segment' })).toBeDisabled()
  })

  it('disables Add Segment while a submission is in flight', async () => {
    const user = userEvent.setup()
    let resolveAdd: ((segment: TranscriptSegment) => void) | undefined
    mockedAddSegment.mockReturnValue(new Promise((resolve) => (resolveAdd = resolve)))

    render(<TranscriptPanel projectId="p1" timeline={timeline} onTimelineChange={vi.fn()} />)

    await user.selectOptions(await screen.findByRole('combobox'), 'item-1')
    await user.type(screen.getByPlaceholderText('New segment text'), 'Hello')
    await user.click(screen.getByRole('button', { name: 'Add Segment' }))

    expect(screen.getByRole('button', { name: 'Add Segment' })).toBeDisabled()

    resolveAdd?.({ id: 's1', text: 'Hello', timelineItemId: 'item-1', status: 'edited' })
    await waitFor(() => expect(mockedAddSegment).toHaveBeenCalledTimes(1))
  })

  it('disables the Narrate button for a segment while it is narrating', async () => {
    const user = userEvent.setup()
    mockedRead.mockResolvedValue([{ id: 's1', text: 'Hi', timelineItemId: 'item-1', status: 'edited' }])
    let resolveNarrate: ((segment: TranscriptSegment) => void) | undefined
    mockedNarrate.mockReturnValue(new Promise((resolve) => (resolveNarrate = resolve)))

    render(<TranscriptPanel projectId="p1" timeline={timeline} onTimelineChange={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Narrate' }))
    expect(screen.getByRole('button', { name: 'Narrating' })).toBeDisabled()

    resolveNarrate?.({ id: 's1', text: 'Hi', timelineItemId: 'item-1', status: 'narrated', audioFile: '/a.wav' })
    await waitFor(() => expect(mockedNarrate).toHaveBeenCalledTimes(1))
  })
})
