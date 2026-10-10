import { z } from 'zod'

/**
 * A theme: what a company's videos look like, kept once and followed by every scene.
 *
 * Pure zod and no Node, because the composition reads these types too and runs in a browser.
 */

export const THEME_SCHEMA_VERSION = 1

export const VARIANT_IDS = ['brand', 'light', 'dark'] as const
export type VariantId = (typeof VARIANT_IDS)[number]

export const LOGO_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
export type LogoCorner = (typeof LOGO_CORNERS)[number]

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

export const ThemeLogoSchema = z.object({
  /** Relative to the theme's folder: `logo.svg`, `logo.png`… */
  file: z.string(),
  corner: z.enum(LOGO_CORNERS).default('bottom-right'),
  showOn: z
    .object({
      recordings: z.boolean().default(true),
      slides: z.boolean().default(true)
    })
    .default({})
})

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
