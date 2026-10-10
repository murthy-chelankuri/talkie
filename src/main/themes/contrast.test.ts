import { describe, expect, it } from 'vitest'
import { contrastRatio, fixContrast } from './contrast'
import { defaultThemeDraft } from './schema'

describe('contrast', () => {
  it('measures black on white as the widest there is', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
  })

  it('measures a colour against itself as no contrast at all', () => {
    expect(contrastRatio('#7ab5f0', '#7ab5f0')).toBeCloseTo(1, 5)
  })
})

describe('making a theme readable', () => {
  it('darkens body text that is too pale to read on a light background, and says so', () => {
    const draft = defaultThemeDraft('Acme')
    draft.variants.light.background = '#ffffff'
    draft.variants.light.body = '#999999'

    const { draft: fixed, notes } = fixContrast(draft)

    expect(contrastRatio(fixed.variants.light.body, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(notes.join(' ')).toMatch(/light.*body.*#999999/i)
  })

  it('lightens a heading lost on a dark background', () => {
    const draft = defaultThemeDraft('Acme')
    draft.variants.dark.background = '#101010'
    draft.variants.dark.heading = '#333333'

    const { draft: fixed } = fixContrast(draft)

    expect(contrastRatio(fixed.variants.dark.heading, '#101010')).toBeGreaterThanOrEqual(3)
  })

  it('keeps an accent visible as a mark against its own background', () => {
    const draft = defaultThemeDraft('Acme')
    draft.variants.brand.background = '#ffd400'
    draft.variants.brand.accent = '#ffe066'

    const { draft: fixed } = fixContrast(draft)

    expect(contrastRatio(fixed.variants.brand.accent, '#ffd400')).toBeGreaterThanOrEqual(3)
  })

  it('leaves a theme that already reads well exactly as it was', () => {
    const draft = defaultThemeDraft('Acme')

    const { draft: fixed, notes } = fixContrast(draft)

    expect(fixed).toEqual(draft)
    expect(notes).toEqual([])
  })
})
