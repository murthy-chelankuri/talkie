import { describe, expect, it } from 'vitest'
import { backgroundFor } from './backgroundFor'
import type { RenderTheme } from './renderTheme'

const theme: RenderTheme = {
  stamp: '0',
  company: '',
  tagline: '',
  website: '',
  variants: {
    brand: { background: '#2e2310', heading: '#ffffff', body: '#eeeeee', accent: '#e9b949' },
    light: { background: '#ffffff', heading: '#000000', body: '#333333', accent: '#1a4bb8' },
    dark: { background: '#111111', heading: '#ffffff', body: '#cccccc', accent: '#7ab5f0' }
  },
  fonts: { heading: { family: 'x', urls: [] }, body: { family: 'y', urls: [] } },
  backgrounds: { content: { dark: { url: 'data:bg', fit: 'cover', scrim: 0.5 } } },
  caption: 'dark'
}

describe('backgroundFor', () => {
  it('returns the entry for a context and variant', () => {
    expect(backgroundFor(theme, 'content', 'dark')).toEqual({ url: 'data:bg', fit: 'cover', scrim: 0.5 })
  })
  it('is undefined for a context with no image', () => {
    expect(backgroundFor(theme, 'card', 'dark')).toBeUndefined()
  })
  it('is undefined for a theme with no backgrounds', () => {
    expect(backgroundFor({ ...theme, backgrounds: undefined }, 'content', 'dark')).toBeUndefined()
  })
})
