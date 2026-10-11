import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Inspector } from './Inspector'
import type { TimelineItem, TranscriptSegment } from '../../api/projectClient'

const slide = { id: 's', kind: 'scene', start: 90, duration: 150, data: { title: 'How it works', bullets: [], style: { theme: 'dark' } } } as TimelineItem
const recording = { id: 'v', kind: 'video', start: 0, duration: 90, data: { src: 'x.webm', trimBefore: 120, trimAfter: 570 } } as TimelineItem
const html = { id: 'h', kind: 'html', start: 240, duration: 150, data: { src: 'x', title: 'Revenue', style: { theme: 'light' }, params: {}, check: { problems: ['Uses text in #ff0000'] } } } as TimelineItem
const timeline = [recording, slide, html]
const segments = [{ id: 'g', timelineItemId: 's', text: 'Hi', voice: 'Samantha' }] as unknown as TranscriptSegment[]
const progress = { silent: [], unwritten: [], otherVoice: [], voiced: 1, needing: [] }

function inspect(item: TimelineItem | null, extra: Partial<Parameters<typeof Inspector>[0]> = {}) {
  const handlers = { onEdit: vi.fn(), onLook: vi.fn(), onNarrate: vi.fn(), onDraft: vi.fn(), onSplit: vi.fn(), onDelete: vi.fn() }
  render(
    <Inspector
      item={item}
      timeline={timeline}
      segments={segments}
      progress={progress}
      themeName={null}
      playheadFrame={() => 120}
      busy={{ narrating: false, drafting: false }}
      {...handlers}
      {...extra}
    />
  )
  return handlers
}

describe('the inspector', () => {
  it('shows the project when nothing is selected', () => {
    inspect(null)

    expect(screen.getByText('0:13')).toBeInTheDocument()
    expect(screen.getByText('1 of 3 voiced')).toBeInTheDocument()
    expect(screen.getByText('Talkie’s own look')).toBeInTheDocument()
  })

  it('shows a slide: where it is, its look, its length and voice', () => {
    inspect(slide)

    expect(screen.getByText('How it works')).toBeInTheDocument()
    expect(screen.getByText('Clip 2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('0:05')).toBeInTheDocument()
    expect(screen.getByText('Samantha')).toBeInTheDocument()
  })

  it('changes a scene’s look', async () => {
    const { onLook } = inspect(slide)

    await userEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(onLook).toHaveBeenCalledWith(slide, 'light')
  })

  it('shows the stretch of footage a recording plays, and no look', () => {
    inspect(recording)

    expect(screen.getByText('0:04–0:19')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Look' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('lists what the check found in an HTML scene', () => {
    inspect(html)

    expect(screen.getByText('Uses text in #ff0000')).toBeInTheDocument()
  })

  it('acts on the clip: edit, voice, write, split where the playhead is, delete', async () => {
    const handlers = inspect(slide)

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Voice it again' }))
    await userEvent.click(screen.getByRole('button', { name: 'Write the words' }))
    await userEvent.click(screen.getByRole('button', { name: 'Split at playhead' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete clip' }))

    expect(handlers.onEdit).toHaveBeenCalledWith(slide)
    expect(handlers.onNarrate).toHaveBeenCalledWith(slide)
    expect(handlers.onDraft).toHaveBeenCalledWith(slide)
    expect(handlers.onSplit).toHaveBeenCalledWith(slide, 120)
    expect(handlers.onDelete).toHaveBeenCalledWith(slide)
  })

  it('will not split a clip the playhead is not in', () => {
    inspect(html)

    expect(screen.getByRole('button', { name: 'Split at playhead' })).toBeDisabled()
  })
})
