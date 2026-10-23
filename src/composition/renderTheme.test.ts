import { describe, expect, it } from 'vitest'
import { logoUrlFor, type RenderTheme } from './renderTheme'

const theme = (logo: RenderTheme['logo']): RenderTheme => ({
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
  logo,
  caption: 'dark'
})

describe('logoUrlFor', () => {
  const both = theme({ light: 'data:light', dark: 'data:dark', corner: 'bottom-right', showOn: { recordings: true, slides: true } })

  it('uses the dark-ground logo on a dark surface', () => {
    expect(logoUrlFor(both, '#111111')).toBe('data:dark')
  })
  it('uses the light-ground logo on a light surface', () => {
    expect(logoUrlFor(both, '#ffffff')).toBe('data:light')
  })
  it('falls back to the only slot that exists', () => {
    const onlyLight = theme({ light: 'data:light', corner: 'bottom-right', showOn: { recordings: true, slides: true } })
    expect(logoUrlFor(onlyLight, '#111111')).toBe('data:light')
  })
  it('prefers the dark-ground logo when the surface is unknown', () => {
    expect(logoUrlFor(both, undefined)).toBe('data:dark')
  })
  it('is undefined when there is no logo', () => {
    expect(logoUrlFor(theme(undefined), '#111111')).toBeUndefined()
  })
})
