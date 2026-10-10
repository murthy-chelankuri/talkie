import { describe, expect, it } from 'vitest'
import { ThemeDraftSchema, ThemeSchema, defaultThemeDraft } from './schema'

describe('a theme', () => {
  it('parses whole, with every variant and both fonts', () => {
    const theme = ThemeSchema.parse({
      id: 'abc',
      createdAt: '2026-10-09T00:00:00.000Z',
      schemaVersion: 1,
      ...defaultThemeDraft('Acme')
    })

    expect(theme.name).toBe('Acme')
    expect(Object.keys(theme.variants).sort()).toEqual(['brand', 'dark', 'light'])
    expect(theme.fonts.heading.family).toBeTruthy()
  })

  it('refuses a colour that is not a hex value, rather than storing something nothing can draw', () => {
    const draft = defaultThemeDraft('Acme')
    draft.variants.brand.accent = 'blue-ish'

    expect(ThemeDraftSchema.safeParse(draft).success).toBe(false)
  })

  it('starts from the looks slides already had, so a new theme is never a blank page', () => {
    const draft = defaultThemeDraft('Acme')

    expect(draft.variants.dark.heading).toBe('#f4f6f9')
    expect(draft.variants.light.heading).toBe('#1c1a16')
    expect(draft.variants.brand.heading).toBe('#fbf3e2')
    expect(draft.overlays.caption).toBe('dark')
  })

  it('reads a colour written in capitals or three digits as the same colour', () => {
    const draft = defaultThemeDraft('Acme')
    draft.variants.brand.accent = '#ABC'

    expect(ThemeDraftSchema.parse(draft).variants.brand.accent).toBe('#aabbcc')
  })
})
