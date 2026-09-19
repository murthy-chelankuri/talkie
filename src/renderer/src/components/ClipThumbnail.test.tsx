import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

afterEach(() => vi.unstubAllGlobals())
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

describe('the diagram on a clip in the timeline', () => {
  function diagram(src: string): TimelineItem {
    return { id: 'd', kind: 'diagram', start: 0, duration: 150, data: { source: 'graph LR; A-->B', src } } as TimelineItem
  }

  it('puts the drawing in the document, where the labels inside it will draw', async () => {
    // Mermaid writes its labels as HTML inside the SVG, and a browser will not render HTML in
    // an `<img>` — shown that way a diagram came out as empty boxes. The player has always
    // injected the same file; this matches it.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><span>Watchlist</span></foreignObject></svg>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => svg }))

    const { container } = render(<ClipThumbnail item={diagram('http://assets/d.svg')} />)

    await waitFor(() => expect(container.querySelector('svg')).toBeTruthy())
    expect(container.querySelector('foreignObject')).toBeTruthy()
    expect(container.textContent).toContain('Watchlist')
  })

  it('leaves the clip readable when the drawing cannot be fetched', async () => {
    // A missing drawing must not take the clip with it: the background and the kind label are
    // still enough to find it by.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('gone')))

    const { container } = render(<ClipThumbnail item={diagram('http://assets/missing.svg')} />)

    await waitFor(() => expect(container.querySelector('span')).toBeTruthy())
    expect(container.querySelector('svg')).toBeNull()
  })

  it('shows nothing at all for a diagram that has never been drawn', () => {
    const undrawn = { id: 'd', kind: 'diagram', start: 0, duration: 150, data: { source: 'graph LR; A-->B' } } as TimelineItem

    const { container } = render(<ClipThumbnail item={undrawn} />)

    expect(container.firstChild).toBeNull()
  })
})
