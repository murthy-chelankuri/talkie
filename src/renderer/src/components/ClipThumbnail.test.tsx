import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ClipThumbnail } from './Timeline'
import type { TimelineItem } from '../api/projectClient'

function scene(data: Record<string, unknown>): TimelineItem {
  return { id: 'a', kind: 'scene', start: 0, duration: 150, data } as TimelineItem
}

describe('the label on a slide in the timeline', () => {
  it('shows the words, not the markup around them', () => {
    render(<ClipThumbnail item={scene({ title: 'Record it <b>silent</b>', bullets: [] })} />)

    expect(screen.getByText('Record it silent')).toBeInTheDocument()
  })

  it('shows the words of a coloured phrase', () => {
    render(
      <ClipThumbnail
        item={scene({ title: 'Record it <span style="color:#d3a24c">silent</span>', bullets: [] })}
      />
    )

    expect(screen.getByText('Record it silent')).toBeInTheDocument()
  })

  it('strips the markup from the lines as well', () => {
    render(<ClipThumbnail item={scene({ title: 'T', bullets: ['<b>One</b>', '<i>Two</i>'] })} />)

    expect(screen.getByText('One · Two')).toBeInTheDocument()
  })

  it('names a slide that has no title yet', () => {
    render(<ClipThumbnail item={scene({ title: '', bullets: [] })} />)

    expect(screen.getByText('Untitled slide')).toBeInTheDocument()
  })
})
