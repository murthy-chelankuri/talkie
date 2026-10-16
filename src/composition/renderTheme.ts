import { createContext, useContext } from 'react'
import type { LogoCorner, Theme, Variant, VariantId } from '../main/themes/schema'

/**
 * A theme as the composition receives it: everything it needs to draw, with nothing left to
 * fetch.
 *
 * Logo and fonts arrive as data URLs rather than asset-server URLs. That server is rooted at the
 * projects folder, and widening it to the whole of ~/Talkie would put settings.json — API keys
 * and all — within reach of anything holding a link. See toRenderTheme.ts, which makes these for
 * both the preview and the export.
 */
export interface RenderTheme {
  /** Changes whenever anything a drawing depends on changes — see themeStamp. */
  stamp: string
  company: string
  tagline: string
  website: string
  variants: Record<VariantId, Variant>
  fonts: {
    heading: { family: string; urls: string[] }
    body: { family: string; urls: string[] }
  }
  logo?: { url: string; corner: LogoCorner; showOn: { recordings: boolean; slides: boolean } }
  /** Which variant the caption bar is drawn in. */
  caption: VariantId
}

export const ThemeContext = createContext<RenderTheme | null>(null)

/** The project's theme, or null for a project that has none — which draws as it always did. */
export function useRenderTheme(): RenderTheme | null {
  return useContext(ThemeContext)
}

/**
 * A short fingerprint of what a theme looks like.
 *
 * A diagram is drawn once and kept as an SVG with its colours inside it, so it has to know
 * whether the theme it was drawn in is still the one in force. FNV-1a over the colours and font
 * names: no crypto, because this runs in the composition as well as in main.
 */
export function themeStamp(theme: Pick<Theme, 'variants' | 'fonts'>): string {
  const text = JSON.stringify([theme.variants, theme.fonts.heading.family, theme.fonts.body.family])
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * The weight a font file is drawn at. A weight in its name ("Inter-600") is the one Talkie gave the
 * open fonts it downloads — some are one variable file saved once per weight, so the name is what
 * tells them apart. Otherwise the weight read from inside the file (`;weight=700`, or `100-900` for
 * a variable font; see toRenderTheme.ts), and failing both, every weight.
 */
function weightOf(url: string): string {
  const name = /;name=([\w-]+)/.exec(url)?.[1] ?? ''
  const named = /(?:^|[-_])([1-9]00)(?:$|[-_])/.exec(name)?.[1]
  if (named) return named
  const read = /;weight=(\d+(?:-\d+)?)/.exec(url)?.[1]
  return read ? read.replace('-', ' ') : '100 900'
}

/** Italic where the file says it slants. */
function styleOf(url: string): string {
  return /;style=italic/.test(url) ? 'italic' : 'normal'
}

/** The @font-face rules for the families a theme brings files for. Empty when it brings none. */
export function fontFaceCss(theme: RenderTheme): string {
  const families = [theme.fonts.heading, theme.fonts.body]
  const seen = new Set<string>()
  const rules: string[] = []

  for (const { family, urls } of families) {
    for (const url of urls) {
      const key = `${family}|${url}`
      if (seen.has(key)) continue
      seen.add(key)
      rules.push(
        `@font-face{font-family:"${family.replace(/"/g, '')}";src:url(${url});font-weight:${weightOf(url)};font-style:${styleOf(url)};font-display:block}`
      )
    }
  }
  return rules.join('\n')
}
