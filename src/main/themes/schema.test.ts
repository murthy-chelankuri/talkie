import { describe, expect, it } from 'vitest'
import {
  BackgroundEntrySchema,
  LOCK_KEYS,
  THEME_SCHEMA_VERSION,
  ThemeDraftSchema,
  ThemeLogoSchema,
  ThemeSchema,
  defaultThemeDraft,
  migrateTheme
} from './schema'

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

describe('schema v2', () => {
  it('is version 2', () => {
    expect(THEME_SCHEMA_VERSION).toBe(2)
  })

  it('reads a logo as a light/dark pair with placement and clear space', () => {
    const logo = ThemeLogoSchema.parse({
      light: { file: 'logos/light.svg' },
      dark: { file: 'logos/dark.svg' },
      clearSpace: 0.5,
      minHeight: 24
    })
    expect(logo.light?.file).toBe('logos/light.svg')
    expect(logo.dark?.file).toBe('logos/dark.svg')
    expect(logo.corner).toBe('bottom-right')
    expect(logo.clearSpace).toBe(0.5)
    expect(logo.minHeight).toBe(24)
  })

  it('defaults a background entry to a cover fit and a 0.35 scrim', () => {
    const bg = BackgroundEntrySchema.parse({ file: 'backgrounds/card-dark.jpg' })
    expect(bg.fit).toBe('cover')
    expect(bg.scrim).toBe(0.35)
  })

  it('closes the lock enum to the known groups', () => {
    expect(LOCK_KEYS).toContain('variants.brand')
    expect(LOCK_KEYS).toContain('logo')
    expect(LOCK_KEYS).toContain('backgrounds')
  })

  it('migrates a v1 theme, mirroring its one logo into both slots', () => {
    const v1 = {
      id: 't1',
      createdAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
      name: 'Acme',
      company: 'Acme',
      tagline: '',
      website: '',
      variants: {
        brand: { background: '#2e2310', heading: '#fbf3e2', body: '#e0cfa8', accent: '#e9b949' },
        light: { background: '#f7f3ea', heading: '#1c1a16', body: '#514b41', accent: '#1a5fb4' },
        dark: { background: '#171b22', heading: '#f4f6f9', body: '#c9cedb', accent: '#7ab5f0' }
      },
      fonts: {
        heading: { family: 'Newsreader Variable', files: [], source: 'builtin' },
        body: { family: 'Geist Variable', files: [], source: 'builtin' }
      },
      logo: { file: 'logo.svg', corner: 'top-left', showOn: { recordings: true, slides: true } },
      overlays: { highlight: '#7ab5f0', caption: 'dark' }
    }
    const theme = ThemeSchema.parse(migrateTheme(v1))
    expect(theme.schemaVersion).toBe(2)
    expect(theme.logo?.light?.file).toBe('logo.svg')
    expect(theme.logo?.dark?.file).toBe('logo.svg')
    expect(theme.logo?.corner).toBe('top-left')
  })

  it('leaves a v1 theme with no logo logo-less', () => {
    const v1 = {
      schemaVersion: 1,
      name: 'No Logo',
      variants: {
        brand: { background: '#000000', heading: '#ffffff', body: '#cccccc', accent: '#7ab5f0' },
        light: { background: '#ffffff', heading: '#000000', body: '#333333', accent: '#1a4bb8' },
        dark: { background: '#111111', heading: '#ffffff', body: '#bbbbbb', accent: '#7ab5f0' }
      },
      fonts: { heading: { family: 'Newsreader Variable' }, body: { family: 'Geist Variable' } }
    }
    const migrated = migrateTheme(v1) as { logo?: unknown }
    expect(migrated.logo).toBeUndefined()
  })
})
