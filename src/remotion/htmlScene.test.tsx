import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'

vi.mock('../video', () => ({
  Fill: ({ children, style }: { children?: ReactNode; style?: object }) => <div style={style}>{children}</div>,
  useFrame: () => 0,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 90 }),
  useRenderMode: () => 'preview',
  hold: () => () => undefined
}))

const { HtmlScene } = await import('./items/HtmlScene')

describe('an HTML scene in the video', () => {
  it('plays its page in a frame that may run scripts and nothing more', () => {
    const markup = renderToStaticMarkup(
      <HtmlScene data={{ src: 'http://127.0.0.1:1/s/p/sources/html/r/index.html', title: 'Revenue', style: { theme: 'dark' }, params: {} }} />
    )

    expect(markup).toMatch(/<iframe[^>]*sandbox="allow-scripts"/)
    expect(markup).not.toMatch(/allow-same-origin|allow-popups|allow-forms|allow-top-navigation/)
    expect(markup).toContain('src="http://127.0.0.1:1/s/p/sources/html/r/index.html"')
  })
})
