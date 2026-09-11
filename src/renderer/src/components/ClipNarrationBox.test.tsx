import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipNarrationBox } from './ClipNarrationBox'
import type { TimelineItem, TranscriptSegment } from '../api/projectClient'

const item: TimelineItem = { id: 'item-1', kind: 'video', start: 90, duration: 300, data: { src: '/v.mp4' } }
const narratedSegment: TranscriptSegment = {
  id: 'seg-1',
  text: 'Existing narration',
  timelineItemId: 'item-1',
  status: 'narrated'
}

function renderBox(props: Partial<Parameters<typeof ClipNarrationBox>[0]> = {}) {
  return render(
    <ClipNarrationBox
      item={item}
      segments={[narratedSegment]}
      active={false}
      narrating={false}
      currentVoice="Samantha"
      drafting={false}
      recording={false}
      onRecord={vi.fn()}
      onStopRecording={vi.fn()}
      onCommit={vi.fn()}
      onNarrate={vi.fn()}
      onDraft={vi.fn()}
      {...props}
    />
  )
}

const box = () => screen.getByRole('textbox', { name: 'Narration for video at 0:03' })

describe('ClipNarrationBox', () => {
  it('shows the clip narration', () => {
    renderBox()
    expect(box()).toHaveValue('Existing narration')
  })

  it('is empty and prompting for a clip with no narration', () => {
    renderBox({ segments: [] })
    expect(box()).toHaveValue('')
    expect(box()).toHaveAttribute('placeholder', 'Narration…')
  })

  it('commits what was typed when focus leaves', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    renderBox({ onCommit })

    await user.clear(box())
    await user.type(box(), 'Rewritten')
    await user.tab()

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(item, 'Rewritten'))
  })

  it('reports its narration state', () => {
    renderBox()
    expect(screen.getByText('Voiced')).toBeInTheDocument()
  })

  it('flags a clip whose narration has not been voiced yet', () => {
    renderBox({ segments: [{ ...narratedSegment, status: 'edited' }] })
    expect(screen.getByText('Silent')).toBeInTheDocument()
  })

  it('narrates the clip on request', async () => {
    const user = userEvent.setup()
    const onNarrate = vi.fn()
    renderBox({ onNarrate })

    await user.click(screen.getByRole('button', { name: /^Narrate / }))

    expect(onNarrate).toHaveBeenCalledWith(item)
  })

  it('cannot narrate an empty clip', () => {
    renderBox({ segments: [] })
    expect(screen.getByRole('button', { name: /^Narrate / })).toBeDisabled()
  })

  it('cannot narrate text that has not been committed yet', async () => {
    const user = userEvent.setup()
    renderBox()

    await user.type(box(), ' and more')

    expect(screen.getByRole('button', { name: /^Narrate / })).toBeDisabled()
  })

  it('shows progress while narrating', () => {
    renderBox({ narrating: true })
    expect(screen.getByRole('button', { name: /^Narrating / })).toBeDisabled()
  })
})
