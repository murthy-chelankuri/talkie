import { z } from 'zod'

/**
 * A theme: what a company's videos look like, kept once and followed by every scene.
 *
 * Pure zod and no Node, because the composition reads these types too and runs in a browser.
 */

export const THEME_SCHEMA_VERSION = 2

export const VARIANT_IDS = ['brand', 'light', 'dark'] as const
export type VariantId = (typeof VARIANT_IDS)[number]

export const LOGO_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
export type LogoCorner = (typeof LOGO_CORNERS)[number]

/** A logo comes in two, for the two grounds it sits on — a corporate brand gives a different mark for each. */
export const LOGO_SLOTS = ['light', 'dark'] as const
export type LogoSlot = (typeof LOGO_SLOTS)[number]

/**
 * A colour as `#rrggbb`, whatever form it arrived in.
 *
 * Colours come from websites, PDFs and models as well as from a picker, so `#ABC` and `#AABBCC`
 * have to be read as the colour they are. One stored form is what lets two themes, or a theme
 * and the colour a contrast fix produced, be compared at all.
 */
export const HexColourSchema = z
  .string()
  .trim()
  .regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, 'Expected a colour like #1a5fb4')
  .transform((value) => {
    const hex = value.slice(1).toLowerCase()
    return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex}`
  })

/**
 * One look a slide can take. A theme has three, so a long video can vary its rhythm — a brand
 * slide to open a section, light ones to explain in — without any slide leaving the brand.
 */
export const VariantSchema = z.object({
  background: HexColourSchema,
  heading: HexColourSchema,
  body: HexColourSchema,
  /** The rule under a title, the bullets, and anything marked in the accent. */
  accent: HexColourSchema
})

export const FontChoiceSchema = z.object({
  family: z.string().min(1),
  /** Relative to the theme's folder. Empty for a font Talkie already has. */
  files: z.array(z.string()).default([]),
  /**
   * Where it came from, which decides what may be done with it: an open font from Google Fonts,
   * the user's own (possibly licensed) file, or one built into Talkie.
   */
  source: z.enum(['google', 'user', 'builtin']).default('builtin')
})

/** One mark, for one ground. Relative to the theme's folder: `logos/light.svg`, `logos/dark.png`… */
const LogoFileSchema = z.object({ file: z.string() })

export const ThemeLogoSchema = z.object({
  /** For light backgrounds (dark ink). */
  light: LogoFileSchema.optional(),
  /** For dark backgrounds (light ink). */
  dark: LogoFileSchema.optional(),
  corner: z.enum(LOGO_CORNERS).default('bottom-right'),
  showOn: z
    .object({
      recordings: z.boolean().default(true),
      slides: z.boolean().default(true)
    })
    .default({}),
  /** Multiples of the logo's height kept clear around it; a compliance warning, never a hard crop. */
  clearSpace: z.number().optional(),
  /** px; below this the logo is too small to read — a compliance warning, not a floor that resizes it. */
  minHeight: z.number().optional()
})

export const BackgroundFitSchema = z.enum(['cover', 'contain', 'tile'])
export type BackgroundFit = z.infer<typeof BackgroundFitSchema>

/**
 * One surface's background image. Stored verbatim — never re-encoded or downscaled — and tinted at
 * render by a scrim: a wash of the variant's own background colour over it, so text keeps a
 * controlled ground to sit on rather than raw imagery.
 */
export const BackgroundEntrySchema = z.object({
  /** Relative to the theme's folder: `backgrounds/card-dark.jpg`… */
  file: z.string(),
  fit: BackgroundFitSchema.default('cover'),
  /** 0 clears nothing, 1 hides the image; a scrim too low for text is a compliance warning. */
  scrim: z.number().min(0).max(1).default(0.35)
})
export type BackgroundEntry = z.infer<typeof BackgroundEntrySchema>

const BackgroundContextSchema = z.object({
  brand: BackgroundEntrySchema.optional(),
  light: BackgroundEntrySchema.optional(),
  dark: BackgroundEntrySchema.optional()
})

/** Background imagery per surface. A diagram keeps its solid themed ground and is never here. */
export const ThemeBackgroundsSchema = z.object({
  card: BackgroundContextSchema.optional(),
  content: BackgroundContextSchema.optional()
})
export type ThemeBackgrounds = z.infer<typeof ThemeBackgroundsSchema>

export const PaletteColourSchema = z.object({ name: z.string(), hex: HexColourSchema })
export type PaletteColour = z.infer<typeof PaletteColourSchema>
export const BrandSchema = z.object({ palette: z.array(PaletteColourSchema).optional() })

/** The groups a person can freeze. A closed set, so the editor and an agent name the same things. */
export const LOCK_KEYS = [
  'variants.brand', 'variants.light', 'variants.dark',
  'fonts.heading', 'fonts.body', 'logo', 'backgrounds'
] as const
export type LockKey = (typeof LOCK_KEYS)[number]
export const LockKeySchema = z.enum(LOCK_KEYS)

const ThemeFields = {
  name: z.string().min(1),
  company: z.string().default(''),
  tagline: z.string().default(''),
  website: z.string().default(''),
  variants: z.object({
    brand: VariantSchema,
    light: VariantSchema,
    dark: VariantSchema
  }),
  fonts: z.object({
    heading: FontChoiceSchema,
    body: FontChoiceSchema
  }),
  logo: ThemeLogoSchema.optional(),
  backgrounds: ThemeBackgroundsSchema.optional(),
  brand: BrandSchema.optional(),
  /** Groups a person has frozen: automation — AI generation and the contrast fix — never moves them. */
  locks: z.array(LockKeySchema).optional(),
  overlays: z
    .object({
      /** The ring drawn round each click while recording — baked into the footage. */
      highlight: HexColourSchema.default('#7ab5f0'),
      /** Which variant the caption bar is drawn in. */
      caption: z.enum(VARIANT_IDS).default('dark')
    })
    .default({}),
  /**
   * What a generated theme was made from, and what was changed on the way — "darkened body text
   * for readability". Shown in the editor, because a theme that quietly differs from the brand
   * it was taken from is one nobody can trust.
   */
  provenance: z
    .object({
      from: z.array(z.string()).default([]),
      notes: z.array(z.string()).default([])
    })
    .optional()
}

export const ThemeDraftSchema = z.object(ThemeFields)

export const ThemeSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  schemaVersion: z.number().int(),
  ...ThemeFields
})

export type Variant = z.infer<typeof VariantSchema>
export type FontChoice = z.infer<typeof FontChoiceSchema>
export type ThemeLogo = z.infer<typeof ThemeLogoSchema>
export type ThemeDraft = z.infer<typeof ThemeDraftSchema>
export type Theme = z.infer<typeof ThemeSchema>

/** The two families Talkie ships, which every theme can fall back on. */
export const BUILTIN_FONTS = {
  sans: 'Geist Variable',
  serif: 'Newsreader Variable'
} as const

/**
 * Where a new theme starts: the looks slides already had.
 *
 * Dark, light and brand are graphite, paper and brass as they were, so a theme made from nothing
 * draws the video it would have drawn anyway. Each accent is chosen to read against its own
 * background — the one shared azure the slides used was too pale to see on paper.
 */
export function defaultThemeDraft(name: string): ThemeDraft {
  return ThemeDraftSchema.parse({
    name,
    variants: {
      dark: { background: '#171b22', heading: '#f4f6f9', body: '#c9cedb', accent: '#7ab5f0' },
      light: { background: '#f7f3ea', heading: '#1c1a16', body: '#514b41', accent: '#1a5fb4' },
      brand: { background: '#2e2310', heading: '#fbf3e2', body: '#e0cfa8', accent: '#e9b949' }
    },
    fonts: {
      heading: { family: BUILTIN_FONTS.serif, source: 'builtin' },
      body: { family: BUILTIN_FONTS.sans, source: 'builtin' }
    }
  })
}

/**
 * An older theme read as a v2 one. A v1 theme stored one logo for every ground; v2 keeps a
 * light-ground and a dark-ground mark, so the one it had serves both until the editor or AI fills
 * them apart. Everything else is forward-compatible through zod defaults — missing fields fill
 * themselves on parse — so only the logo needs moving. Applied before ThemeSchema.parse on the
 * way in, so a library written by an older Talkie opens rather than being skipped as unreadable.
 */
export function migrateTheme(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const theme = raw as Record<string, unknown>
  const version = typeof theme.schemaVersion === 'number' ? theme.schemaVersion : 1
  if (version >= THEME_SCHEMA_VERSION) return raw
  const next: Record<string, unknown> = { ...theme, schemaVersion: THEME_SCHEMA_VERSION }
  const logo = theme.logo as { file?: string } | undefined
  if (logo && typeof logo.file === 'string' && !('light' in logo) && !('dark' in logo)) {
    const { file, ...rest } = logo
    next.logo = { ...rest, light: { file }, dark: { file } }
  }
  return next
}
