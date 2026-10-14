import { describe, expect, it } from 'vitest'
import { resolveSceneTheme } from './sceneTheme'
import type { RenderTheme } from './renderTheme'
import { SceneStyleSchema } from '../main/project/timeline/schema'

const theme: RenderTheme = {
  stamp: 'abc',
  company: 'Acme',
  tagline: 'Payments, simply',
  website: 'acme.com',
  variants: {
    brand: { background: '#0a2540', heading: '#ffffff', body: '#d6e2f0', accent: '#635bff' },
    light: { background: '#ffffff', heading: '#0a2540', body: '#425466', accent: '#635bff' },
    dark: { background: '#06111f', heading: '#f6f9fc', body: '#adbdcc', accent: '#80e9ff' }
  },
  fonts: { heading: { family: 'Sohne', urls: [] }, body: { family: 'Inter', urls: [] } },
  caption: 'dark'
}

const style = (overrides = {}) => SceneStyleSchema.parse(overrides)

describe('a slide without a theme', () => {
  it('looks exactly as it always did, old palette names included', () => {
    expect(resolveSceneTheme(style({ theme: 'ink' })).background).toContain('#0b0d11')
    expect(resolveSceneTheme(style({ theme: 'paper' })).heading).toBe('#1c1a16')
  })

  it('draws the new variants in the palettes they stand for', () => {
    expect(resolveSceneTheme(style({ theme: 'dark' }))).toEqual(resolveSceneTheme(style({ theme: 'graphite' })))
    expect(resolveSceneTheme(style({ theme: 'light' }))).toEqual(resolveSceneTheme(style({ theme: 'paper' })))
    expect(resolveSceneTheme(style({ theme: 'brand' }))).toEqual(resolveSceneTheme(style({ theme: 'brass' })))
  })

  it('still honours its own font and accent', () => {
    const resolved = resolveSceneTheme(style({ font: 'sans', accent: '#ff0000' }))
    expect(resolved.headingFont).toContain('Geist')
    expect(resolved.accent).toBe('#ff0000')
  })
})

describe('a slide in a themed project', () => {
  it('takes its variant’s colours and the theme’s fonts', () => {
    const resolved = resolveSceneTheme(style({ theme: 'light' }), theme)

    expect(resolved.background).toBe('#ffffff')
    expect(resolved.heading).toBe('#0a2540')
    expect(resolved.headingFont).toMatch(/^"Sohne"/)
    expect(resolved.bodyFont).toMatch(/^"Inter"/)
  })

  it('ignores a slide’s own accent and font, which would take it off-brand', () => {
    const resolved = resolveSceneTheme(style({ theme: 'brand', accent: '#ff0000', font: 'serif' }), theme)

    expect(resolved.accent).toBe('#635bff')
    expect(resolved.headingFont).toMatch(/^"Sohne"/)
  })

  it('reads an old palette name as the variant nearest it', () => {
    expect(resolveSceneTheme(style({ theme: 'graphite' }), theme).background).toBe('#06111f')
    expect(resolveSceneTheme(style({ theme: 'ink' }), theme).background).toBe('#06111f')
    expect(resolveSceneTheme(style({ theme: 'paper' }), theme).background).toBe('#ffffff')
    expect(resolveSceneTheme(style({ theme: 'brass' }), theme).background).toBe('#0a2540')
  })

  it('keeps alignment and size, which are the slide’s own to choose', () => {
    const resolved = resolveSceneTheme(style({ align: 'center', size: 'large' }), theme)

    expect(resolved.align).toBe('center')
    expect(resolved.headingSize).toBe(116)
  })
})

describe('a new slide', () => {
  it('starts dark, as slides did before themes', () => {
    expect(style().theme).toBe('dark')
  })
})
