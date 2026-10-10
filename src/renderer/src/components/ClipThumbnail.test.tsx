import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

afterEach(() => vi.unstubAllGlobals())
import { ClipThumbnail } from './Timeline'
import type { TimelineItem } from '../api/projectClient'
import { ThemeContext, type RenderTheme } from '../../../remotion/renderTheme'

const acme: RenderTheme = {
  stamp: 'abc',
  company: 'Acme',
  tagline: '',
  website: '',
  variants: {
    brand: { background: '#0a2540', heading: '#ffffff', body: '#d6e2f0', accent: '#635bff' },
    light: { background: '#fafafa', heading: '#0a2540', body: '#425466', accent: '#635bff' },
    dark: { background: '#06111f', heading: '#f6f9fc', body: '#adbdcc', accent: '#80e9ff' }
  },
  fonts: { heading: { family: 'Sohne', urls: [] }, body: { family: 'Inter', urls: [] } },
  caption: 'dark'
}

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

describe('thumbnails in a themed project', () => {
  it('draws a slide in the theme’s colours and type for the look the slide chose', () => {
    const { container } = render(
      <ThemeContext.Provider value={acme}>
        <ClipThumbnail item={scene({ title: 'Checkout', bullets: ['Fast'], style: { theme: 'light' } })} />
      </ThemeContext.Provider>
    )

    expect(container.firstElementChild).toHaveStyle({ background: '#fafafa' })
    expect(screen.getByText('Checkout')).toHaveStyle({ color: '#0a2540' })
    expect(screen.getByText('Checkout').style.fontFamily).toContain('Sohne')
    expect(screen.getByText('Fast')).toHaveStyle({ color: '#425466' })
  })

  it('follows the theme when it changes, without the slide being touched', () => {
    const item = scene({ title: 'Checkout', bullets: [], style: { theme: 'brand' } })
    const { container, rerender } = render(
      <ThemeContext.Provider value={acme}>
        <ClipThumbnail item={item} />
      </ThemeContext.Provider>
    )
    const edited = { ...acme, variants: { ...acme.variants, brand: { ...acme.variants.brand, background: '#01a982' } } }
    rerender(
      <ThemeContext.Provider value={edited}>
        <ClipThumbnail item={item} />
      </ThemeContext.Provider>
    )

    expect(container.firstElementChild).toHaveStyle({ background: '#01a982' })
  })

  it('puts a diagram on its theme background rather than a fixed dark one', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '<svg/>' }))
    const item = { id: 'd', kind: 'diagram', start: 0, duration: 150, data: { source: 'graph LR; A-->B', src: 'http://assets/d.svg', style: { theme: 'light' } } } as TimelineItem

    const { container } = render(
      <ThemeContext.Provider value={acme}>
        <ClipThumbnail item={item} />
      </ThemeContext.Provider>
    )

    expect(container.firstElementChild).toHaveStyle({ background: '#fafafa' })
  })

  it('keeps the dark slide it always showed when the project has no theme', () => {
    const { container } = render(<ClipThumbnail item={scene({ title: 'T', bullets: [] })} />)

    expect((container.firstElementChild as HTMLElement).style.background).toContain('linear-gradient')
  })
})
