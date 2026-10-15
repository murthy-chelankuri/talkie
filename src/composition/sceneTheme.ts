import type { SceneStyle } from '../main/project/timeline/schema'
import type { VariantId } from '../main/themes/schema'
import type { RenderTheme } from './renderTheme'

/**
 * The looks a scene can take, defined once so the editor's preview and the exported video are
 * drawn from the same numbers rather than from two sets that drift apart.
 */
export interface ResolvedSceneTheme {
  background: string
  heading: string
  body: string
  accent: string
  headingFont: string
  bodyFont: string
  align: 'left' | 'center'
  headingSize: number
  bodySize: number
}

const SERIF = 'Newsreader Variable, ui-serif, Georgia, serif'
const SANS = 'Geist Variable, ui-sans-serif, system-ui, sans-serif'

/** The palettes slides had before themes, kept so a project without one draws as it always did. */
const PALETTES = {
  graphite: {
    background: 'linear-gradient(160deg, #232833 0%, #171b22 55%, #101318 100%)',
    heading: '#f4f6f9',
    body: '#c9cedb'
  },
  ink: {
    background: 'linear-gradient(160deg, #14171d 0%, #0b0d11 100%)',
    heading: '#ffffff',
    body: '#a7afbe'
  },
  paper: {
    background: 'linear-gradient(160deg, #fdfbf6 0%, #f2ede2 100%)',
    heading: '#1c1a16',
    body: '#514b41'
  },
  brass: {
    background: 'linear-gradient(160deg, #3a2c10 0%, #23190a 100%)',
    heading: '#fbf3e2',
    body: '#e0cfa8'
  }
} as const

type StyleName = SceneStyle['theme']

/** With no theme, a variant is drawn in the palette it replaced. */
const PALETTE_FOR: Record<StyleName, keyof typeof PALETTES> = {
  dark: 'graphite',
  light: 'paper',
  brand: 'brass',
  graphite: 'graphite',
  ink: 'ink',
  paper: 'paper',
  brass: 'brass'
}

/** With a theme, an old palette name is read as the variant nearest it. */
export const VARIANT_FOR: Record<StyleName, VariantId> = {
  dark: 'dark',
  light: 'light',
  brand: 'brand',
  graphite: 'dark',
  ink: 'dark',
  paper: 'light',
  brass: 'brand'
}

/** A theme's family first, then Talkie's own, so a font that fails to load still reads well. */
function stack(family: string, fallback: string): string {
  return `"${family.replace(/"/g, '')}", ${fallback}`
}

export function resolveSceneTheme(style: SceneStyle | undefined, theme?: RenderTheme | null): ResolvedSceneTheme {
  const large = style?.size === 'large'
  const name: StyleName = style?.theme ?? 'dark'
  const layout = {
    align: style?.align ?? 'left',
    headingSize: large ? 116 : 92,
    bodySize: large ? 56 : 46
  } as const

  // A theme decides colour and type outright: a slide's own accent and font were how a slide
  // went off-brand, which is the thing a theme exists to stop.
  if (theme) {
    const variant = theme.variants[VARIANT_FOR[name] ?? 'dark']
    return {
      ...variant,
      headingFont: stack(theme.fonts.heading.family, SERIF),
      bodyFont: stack(theme.fonts.body.family, SANS),
      ...layout
    }
  }

  return {
    ...PALETTES[PALETTE_FOR[name] ?? 'graphite'],
    accent: style?.accent || '#7ab5f0',
    headingFont: style?.font === 'sans' ? SANS : SERIF,
    bodyFont: SANS,
    ...layout
  }
}
