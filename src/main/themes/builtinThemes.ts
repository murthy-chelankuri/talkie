import { BUILTIN_FONTS, THEME_SCHEMA_VERSION, ThemeSchema, type Theme } from './schema'

/**
 * Themes that come with Talkie, so a first video can look finished without anyone making one.
 *
 * Kept in code rather than in ~/Talkie/Themes: a file there can be deleted or edited, and these are
 * what a project falls back on being able to name. They cannot be changed — duplicating one gives
 * an editable copy. Only Talkie's own two families are used, because those are the fonts every
 * render already has; a built-in theme that needed a download would fail offline, and one that
 * shipped other fonts would bring their licences with it.
 *
 * Every colour clears the contrast floors the editor checks (builtinThemes.test.ts holds them to
 * it), so choosing one never needs a fix.
 */

/** Pure data, so the renderer can tell a built-in apart without asking. */
export const BUILTIN_THEME_PREFIX = 'builtin-'

export function isBuiltinThemeId(id: string): boolean {
  return id.startsWith(BUILTIN_THEME_PREFIX)
}

const SERIF = { family: BUILTIN_FONTS.serif, source: 'builtin' as const }
const SANS = { family: BUILTIN_FONTS.sans, source: 'builtin' as const }

const DEFINITIONS = [
  {
    slug: 'graphite',
    name: 'Graphite',
    description: 'Dark, with warm brass openings — Talkie’s own look',
    variants: {
      brand: { background: '#2e2310', heading: '#fbf3e2', body: '#e0cfa8', accent: '#e9b949' },
      light: { background: '#f7f3ea', heading: '#1c1a16', body: '#514b41', accent: '#1a5fb4' },
      dark: { background: '#171b22', heading: '#f4f6f9', body: '#c9cedb', accent: '#7ab5f0' }
    },
    fonts: { heading: SERIF, body: SANS },
    overlays: { highlight: '#7ab5f0', caption: 'dark' }
  },
  {
    slug: 'midnight',
    name: 'Midnight',
    description: 'Deep navy and teal, for product demos',
    variants: {
      brand: { background: '#0b1f3a', heading: '#ffffff', body: '#c7d3e3', accent: '#4fd1c5' },
      light: { background: '#f5f8fc', heading: '#0b1f3a', body: '#3d4f66', accent: '#1d6fa5' },
      dark: { background: '#0a0f1a', heading: '#f1f5fb', body: '#a9b6c8', accent: '#5ec8f2' }
    },
    fonts: { heading: SANS, body: SANS },
    overlays: { highlight: '#4fd1c5', caption: 'dark' }
  },
  {
    slug: 'forest',
    name: 'Forest',
    description: 'Dark green and mint, calm and steady',
    variants: {
      brand: { background: '#133a2c', heading: '#f2f7f2', body: '#c6dccd', accent: '#8fd694' },
      light: { background: '#f4f7f2', heading: '#15301f', body: '#44574a', accent: '#2f7d4f' },
      dark: { background: '#0d1a14', heading: '#eef5ef', body: '#a8bcae', accent: '#7cc99a' }
    },
    fonts: { heading: SERIF, body: SANS },
    overlays: { highlight: '#8fd694', caption: 'dark' }
  },
  {
    slug: 'daylight',
    name: 'Daylight',
    description: 'Bright white and blue, for training and how-tos',
    variants: {
      brand: { background: '#e8f0fe', heading: '#0b2a5b', body: '#33476b', accent: '#1a5fb4' },
      light: { background: '#ffffff', heading: '#111827', body: '#4b5563', accent: '#2563eb' },
      dark: { background: '#111827', heading: '#f9fafb', body: '#d1d5db', accent: '#60a5fa' }
    },
    fonts: { heading: SANS, body: SANS },
    overlays: { highlight: '#2563eb', caption: 'light' }
  },
  {
    slug: 'sand',
    name: 'Sand',
    description: 'Warm paper and terracotta, for stories',
    variants: {
      brand: { background: '#f3e9dc', heading: '#3b2a1a', body: '#5c4a38', accent: '#a6461f' },
      light: { background: '#fbf8f3', heading: '#2a2118', body: '#5a4d40', accent: '#a6461f' },
      dark: { background: '#2a2118', heading: '#f7efe4', body: '#d6c6b2', accent: '#e58a5f' }
    },
    fonts: { heading: SERIF, body: SANS },
    overlays: { highlight: '#e58a5f', caption: 'light' }
  },
  {
    slug: 'mono',
    name: 'Mono',
    description: 'Black on white with one red, plain and sharp',
    variants: {
      brand: { background: '#ffffff', heading: '#000000', body: '#3a3a3a', accent: '#c62828' },
      light: { background: '#f4f4f4', heading: '#111111', body: '#444444', accent: '#c62828' },
      dark: { background: '#0e0e0e', heading: '#ffffff', body: '#bdbdbd', accent: '#ff6b6b' }
    },
    fonts: { heading: SANS, body: SANS },
    overlays: { highlight: '#c62828', caption: 'light' }
  }
] as const

/** Dark ones first, then light — the order the library shows them in. */
export const BUILTIN_THEMES: readonly Theme[] = DEFINITIONS.map(({ slug, description: _description, ...theme }) =>
  ThemeSchema.parse({
    ...theme,
    id: `${BUILTIN_THEME_PREFIX}${slug}`,
    // Fixed, so a built-in never sorts as newer than the person's own themes.
    createdAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: THEME_SCHEMA_VERSION
  })
)

/**
 * What each one is for, shown in the library. Not the tagline: that is printed on a video's closing
 * card, and belongs to whoever the video is for.
 */
export function builtinDescription(id: string): string | undefined {
  return DEFINITIONS.find(({ slug }) => `${BUILTIN_THEME_PREFIX}${slug}` === id)?.description
}

export function builtinTheme(id: string): Theme | undefined {
  return BUILTIN_THEMES.find((theme) => theme.id === id)
}
