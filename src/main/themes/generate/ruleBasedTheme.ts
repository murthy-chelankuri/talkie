import { contrastRatio, luminance, mix, saturation } from '../contrast'
import { BUILTIN_FONTS, ThemeDraftSchema, type ThemeDraft } from '../schema'
import type { BrandFacts } from './facts'

/** Open families to stand in for a brand font Talkie cannot fetch, chosen by the step that knows. */
export interface FontFallbacks {
  heading?: string
  body?: string
}

export interface Proposal {
  draft: ThemeDraft
  fallbacks: FontFallbacks
  notes: string[]
}

/** White or near-black, whichever reads better on `background`. */
function inkFor(background: string): string {
  return contrastRatio('#ffffff', background) >= contrastRatio('#111827', background) ? '#ffffff' : '#111827'
}

/**
 * A theme built from what was read, by rule — for when there is no model to ask, or the model's
 * answer could not be used. Never as good as judgement, but always a whole theme: an empty draft
 * would leave the person to start again, which is the thing this feature is meant to spare them.
 *
 * The brand colour is the heaviest saturated one, preferring what was a button, a logo or written
 * in a guide over a background that happened to be coloured. Light and dark are the page's own
 * near-white and near-black where it has them.
 */
export function ruleBasedTheme(facts: BrandFacts, name: string): Proposal {
  const colours = facts.colours
  const saturated = colours.filter((c) => saturation(c.hex) > 0.25 && luminance(c.hex) > 0.02 && luminance(c.hex) < 0.85)
  const preferred = saturated.filter((c) => ['button', 'logo', 'document', 'link'].includes(c.role))
  const primary = (preferred[0] ?? saturated[0])?.hex ?? '#2e5bff'

  const lightBg = colours.find((c) => luminance(c.hex) > 0.85)?.hex ?? '#ffffff'
  const darkBg = colours.find((c) => luminance(c.hex) < 0.05)?.hex ?? mix(primary, '#000000', 0.82)
  const darkText = colours.find((c) => luminance(c.hex) < 0.12 && ['text', 'heading'].includes(c.role))?.hex ?? darkBg
  // A second colour for the brand variant's marks, so they show on a background of the first.
  const secondary = saturated.find((c) => c.hex !== primary && contrastRatio(c.hex, primary) >= 3)?.hex

  const brandInk = inkFor(primary)
  const heading = facts.fonts.find((f) => f.role === 'heading' || f.role === 'document')?.family
  const body = facts.fonts.find((f) => f.role === 'body')?.family ?? heading

  const draft = ThemeDraftSchema.parse({
    name,
    company: name,
    variants: {
      brand: { background: primary, heading: brandInk, body: mix(brandInk, primary, 0.15), accent: secondary ?? mix(brandInk, primary, 0.25) },
      light: { background: lightBg, heading: darkText, body: mix(darkText, lightBg, 0.25), accent: primary },
      dark: { background: darkBg, heading: '#f5f7fa', body: mix('#f5f7fa', darkBg, 0.25), accent: primary }
    },
    fonts: {
      heading: heading ? { family: heading, source: 'google' } : { family: BUILTIN_FONTS.serif, source: 'builtin' },
      body: body ? { family: body, source: 'google' } : { family: BUILTIN_FONTS.sans, source: 'builtin' }
    },
    overlays: { highlight: primary }
  })

  return { draft, fallbacks: { heading: 'Inter', body: 'Inter' }, notes: [] }
}
