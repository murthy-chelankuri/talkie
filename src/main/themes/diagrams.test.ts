import { describe, expect, it } from 'vitest'
import { diagramStamp, staleDiagrams } from './diagrams'
import { MERMAID_CONFIG, mermaidConfigFor } from '../slides/mermaidTheme'
import type { RenderTheme } from '../../composition/renderTheme'

const theme: RenderTheme = {
  stamp: 'abc',
  company: 'Acme',
  tagline: '',
  website: '',
  variants: {
    brand: { background: '#0a2540', heading: '#ffffff', body: '#d6e2f0', accent: '#635bff' },
    light: { background: '#ffffff', heading: '#0a2540', body: '#425466', accent: '#635bff' },
    dark: { background: '#06111f', heading: '#f6f9fc', body: '#adbdcc', accent: '#80e9ff' }
  },
  fonts: { heading: { family: 'Inter', urls: [] }, body: { family: 'Inter', urls: [] } },
  caption: 'dark'
}

const diagram = (id: string, data: object) => ({ id, kind: 'diagram', start: 0, duration: 30, data: { source: 'flowchart LR\n A-->B', ...data } })

describe('diagram colours', () => {
  it('are Talkie’s own without a theme', () => {
    expect(mermaidConfigFor(null)).toEqual(MERMAID_CONFIG)
  })

  it('come from the diagram’s variant of the theme, in its type', () => {
    const config = mermaidConfigFor(theme, 'light')

    expect(config.themeVariables.background).toBe('#ffffff')
    expect(config.themeVariables.primaryTextColor).toBe('#0a2540')
    expect(config.themeVariables.primaryBorderColor).toBe('#635bff')
    expect(config.themeVariables.fontFamily).toMatch(/^"Inter"/)
  })
})

describe('which diagrams need drawing again', () => {
  it('includes one that has never been drawn', () => {
    expect(staleDiagrams([diagram('a', {})], theme).map((d) => d.id)).toEqual(['a'])
  })

  it('includes one drawn in another theme, or in another variant of this one', () => {
    const other = diagram('a', { src: '/a.svg', themeStamp: 'old:dark' })
    const variant = diagram('b', { src: '/b.svg', style: { theme: 'light' }, themeStamp: diagramStamp(theme, 'dark') })

    expect(staleDiagrams([other, variant], theme).map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('includes one drawn in this theme before the way diagrams are drawn changed', () => {
    // Themed diagrams were once all painted on Talkie's dark grey; those carry the stamp of the
    // theme they are in and would never have been drawn again.
    const earlier = diagram('a', { src: '/a.svg', style: { theme: 'light' }, themeStamp: 'abc:light' })

    expect(staleDiagrams([earlier], theme).map((d) => d.id)).toEqual(['a'])
  })

  it('leaves alone one drawn in the theme it is in now', () => {
    const current = diagram('a', { src: '/a.svg', style: { theme: 'dark' }, themeStamp: diagramStamp(theme, 'dark') })

    expect(staleDiagrams([current], theme)).toEqual([])
  })

  it('redraws one in a theme the project no longer has, but never one drawn before themes', () => {
    const themed = diagram('a', { src: '/a.svg', themeStamp: diagramStamp(theme, 'dark') })
    const plain = diagram('b', { src: '/b.svg' })

    expect(staleDiagrams([themed, plain], null).map((d) => d.id)).toEqual(['a'])
  })

  it('pays no attention to anything that is not a diagram, or a diagram with no source', () => {
    const slide = { id: 's', kind: 'scene', start: 0, duration: 30, data: { title: 'x' } }
    const empty = diagram('e', { source: '  ' })

    expect(staleDiagrams([slide, empty], theme)).toEqual([])
  })
})
