import { describe, expect, it } from 'vitest'
import { checkCompliance } from './compliance'
import { defaultThemeDraft } from './schema'

function theme(overrides: Record<string, unknown> = {}): never {
  return { id: 't', createdAt: '2026-01-01T00:00:00.000Z', schemaVersion: 2, ...defaultThemeDraft('T'), ...overrides } as never
}

describe('checkCompliance', () => {
  it('is clean for a default theme', () => {
    expect(checkCompliance(theme())).toEqual([])
  })

  it('warns when body text fails contrast on its background', () => {
    const variants = { ...defaultThemeDraft('T').variants, light: { background: '#ffffff', heading: '#eeeeee', body: '#dddddd', accent: '#eeeeee' } }
    const warnings = checkCompliance(theme({ variants }))
    expect(warnings.some((w) => w.group === 'variants.light' && /read/i.test(w.message))).toBe(true)
  })

  it('warns about a low scrim over a background', () => {
    const t = theme({ backgrounds: { content: { dark: { file: 'backgrounds/content-dark.jpg', fit: 'cover', scrim: 0.1 } } } })
    expect(checkCompliance(t).some((w) => w.group === 'backgrounds')).toBe(true)
  })

  it('warns about an off-palette colour', () => {
    const variants = { ...defaultThemeDraft('T').variants, brand: { background: '#2e2310', heading: '#fbf3e2', body: '#e0cfa8', accent: '#ff00ff' } }
    const t = theme({ brand: { palette: [{ name: 'Ink', hex: '#0b1f3a' }] }, variants })
    expect(checkCompliance(t).some((w) => /palette/i.test(w.message))).toBe(true)
  })

  it('warns when only one logo slot is filled', () => {
    const t = theme({ logo: { light: { file: 'logos/light.svg' }, corner: 'bottom-right', showOn: { recordings: true, slides: true } } })
    expect(checkCompliance(t).some((w) => w.group === 'logo' && /dark|background/i.test(w.message))).toBe(true)
  })
})
