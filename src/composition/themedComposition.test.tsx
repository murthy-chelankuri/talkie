import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { ThemeContext, type RenderTheme } from './renderTheme'
import { logoPlacement } from './LogoOverlay'
import { captionLook } from './CaptionOverlay'
import { fontFaceCss } from './ThemeFonts'

// The scenes' clock wants a player around it; the frame it would report is all these need.
vi.mock('../video', () => ({
  Fill: ({ children, style }: { children?: ReactNode; style?: object }) => <div style={style}>{children}</div>,
  Picture: (props: Record<string, unknown>) => <img {...props} />,
  useFrame: () => 60,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080 }),
  spring: () => 1,
  interpolate: (_v: number, _i: number[], out: number[]) => out[out.length - 1],
  hold: () => () => undefined
}))

const { TextScene } = await import('./items/TextScene')

const theme: RenderTheme = {
  stamp: 's',
  company: 'Acme',
  tagline: 'Payments, simply',
  website: 'acme.com',
  variants: {
    brand: { background: '#0a2540', heading: '#ffffff', body: '#d6e2f0', accent: '#635bff' },
    light: { background: '#ffffff', heading: '#0a2540', body: '#425466', accent: '#635bff' },
    dark: { background: '#06111f', heading: '#f6f9fc', body: '#adbdcc', accent: '#80e9ff' }
  },
  fonts: { heading: { family: 'Inter', urls: ['data:font/woff2;base64,AAA'] }, body: { family: 'Inter', urls: [] } },
  logo: {
    light: 'data:image/png;base64,AAA',
    dark: 'data:image/png;base64,BBB',
    corner: 'top-left',
    showOn: { recordings: true, slides: false }
  },
  caption: 'brand'
}

function slide(data: object, withTheme: RenderTheme | null = theme): string {
  return renderToStaticMarkup(
    <ThemeContext.Provider value={withTheme}>
      <TextScene data={{ title: 'Launch', bullets: [], style: { theme: 'brand', font: 'serif', align: 'left', size: 'regular', accent: '#7ab5f0' }, layout: 'standard', ...data }} />
    </ThemeContext.Provider>
  )
}

describe('the logo on screen', () => {
  it('sits in the theme’s corner over a recording', () => {
    const placed = logoPlacement('video', {}, theme)

    expect(placed).toMatchObject({ top: '4%', left: '4%' })
  })

  it('stays off slides when the theme says so', () => {
    expect(logoPlacement('scene', { layout: 'standard' }, theme)).toBeNull()
  })

  it('never doubles up on an opening or closing card, which shows the logo large already', () => {
    const everywhere = { ...theme, logo: { ...theme.logo!, showOn: { recordings: true, slides: true } } }

    expect(logoPlacement('scene', { layout: 'title' }, everywhere)).toBeNull()
    expect(logoPlacement('scene', { layout: 'standard' }, everywhere)).not.toBeNull()
    expect(logoPlacement('html', { card: 'opening' }, everywhere)).toBeNull()
    expect(logoPlacement('html', { card: 'closing' }, everywhere)).toBeNull()
    expect(logoPlacement('html', {}, everywhere)).not.toBeNull()
  })

  it('is not there at all without a theme', () => {
    expect(logoPlacement('video', {}, null)).toBeNull()
  })
})

describe('the caption bar', () => {
  it('keeps its own dark look without a theme', () => {
    expect(captionLook(null).background).toBe('rgba(10, 12, 16, 0.78)')
  })

  it('takes the theme’s chosen variant and type', () => {
    const look = captionLook(theme)

    expect(look.background.startsWith('#0a2540')).toBe(true)
    expect(look.color).toBe('#ffffff')
    expect(look.fontFamily).toMatch(/^"Inter"/)
  })
})

describe('theme fonts', () => {
  it('declares a face for each family that brings its own files', () => {
    const css = fontFaceCss(theme)

    expect(css).toContain('font-family:"Inter"')
    expect(css).toContain('data:font/woff2;base64,AAA')
  })

  it('declares nothing for a theme using only Talkie’s own type', () => {
    expect(fontFaceCss({ ...theme, fonts: { heading: { family: 'Geist Variable', urls: [] }, body: { family: 'Geist Variable', urls: [] } } })).toBe('')
  })

  it('reads a weight from the file name, so bold text uses the bold file', () => {
    const css = fontFaceCss({ ...theme, fonts: { heading: { family: 'Inter', urls: ['data:font/woff2;name=Inter-600;base64,AAA'] }, body: { family: 'Inter', urls: [] } } })

    expect(css).toContain('font-weight:600')
  })
})

describe('opening and closing cards', () => {
  it('name the company and show the logo large on the opening card', () => {
    const html = slide({ layout: 'title', title: 'Launch video' })

    expect(html).toContain('Acme')
    expect(html).toContain('Launch video')
    expect(html).toContain('<img')
  })

  it('give the tagline and website on the closing card', () => {
    const html = slide({ layout: 'closing', title: 'Thanks for watching' })

    expect(html).toContain('Payments, simply')
    expect(html).toContain('acme.com')
  })

  it('still draw, plainly, in a project with no theme', () => {
    const html = slide({ layout: 'title', title: 'Launch video' }, null)

    expect(html).toContain('Launch video')
    expect(html).not.toContain('<img')
  })

  it('draw an ordinary slide in the variant’s colours', () => {
    expect(slide({})).toContain('#0a2540')
  })
})
