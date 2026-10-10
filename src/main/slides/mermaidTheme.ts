/**
 * How a Talkie diagram looks, and how its SVG is made fit to show.
 *
 * Shared rather than copied because a diagram can now be drawn in two places — in the window,
 * on Chromium's own canvas, and in the MCP server, in a headless browser — and the one thing
 * that must not differ between them is the result. A diagram that renders differently
 * depending on who asked for it is worse than one that cannot be drawn at all.
 */

import type { RenderTheme } from '../../remotion/renderTheme'
import type { VariantId } from '../themes/schema'

/** Colours taken from the app's own palette, so a diagram looks made by Talkie. */
export const MERMAID_THEME = {
  background: '#171b22',
  primaryColor: '#232833',
  primaryTextColor: '#f4f6f9',
  primaryBorderColor: '#7ab5f0',
  lineColor: '#8a93a6',
  secondaryColor: '#2b313c',
  tertiaryColor: '#1b1f27',
  fontFamily: 'Geist Variable, ui-sans-serif, system-ui, sans-serif',
  fontSize: '20px'
}

/**
 * The configuration both drawings are made with, so both come out the same shape.
 *
 * Labels stay as HTML in `<foreignObject>`, which is mermaid's default. Turning that off makes
 * an SVG that draws anywhere, including through an `<img>` — but it was measured doing so by
 * dropping every line after a `<br/>`, and a diagram quietly missing half its labels is worse
 * than one that needs showing a particular way. Everything that shows a diagram puts it in the
 * document rather than in an `<img>`; see DiagramScene and DiagramThumbnail.
 */
export const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  themeVariables: MERMAID_THEME,
  flowchart: { curve: 'basis', padding: 18 }
} as const

/** `a` moved `amount` of the way towards `b`, for node fills a shade off the slide behind them. */
function mix(a: string, b: string, amount: number): string {
  const channel = (hex: string, at: number): number => parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16)
  return `#${[0, 1, 2]
    .map((at) => Math.round(channel(a, at) + (channel(b, at) - channel(a, at)) * amount).toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * The configuration for a diagram on a slide of this variant of the theme — or Talkie's own,
 * without one.
 *
 * Nodes are filled a shade off the slide's background rather than in the brand colour: a diagram
 * is read box by box, and boxes in a saturated brand colour are loud and hard to read on. The
 * brand comes in through the borders, in the accent, and through the type.
 */
export function mermaidConfigFor(theme: RenderTheme | null | undefined, variant: VariantId = 'dark') {
  if (!theme) return MERMAID_CONFIG
  const { background, heading, body, accent } = theme.variants[variant]
  return {
    ...MERMAID_CONFIG,
    themeVariables: {
      background,
      primaryColor: mix(background, heading, 0.1),
      primaryTextColor: heading,
      primaryBorderColor: accent,
      lineColor: body,
      secondaryColor: mix(background, heading, 0.16),
      tertiaryColor: mix(background, heading, 0.05),
      fontFamily: `"${theme.fonts.body.family.replace(/"/g, '')}", Geist Variable, ui-sans-serif, system-ui, sans-serif`,
      fontSize: MERMAID_THEME.fontSize
    }
  }
}

/**
 * Make the SVG ready to be shown large, and to be shown anywhere.
 *
 * Mermaid sizes its output to the diagram's natural width and caps it with an inline
 * `max-width`, which leaves a wide flowchart drawn small in the middle of a frame however much
 * room it is given. It also draws on transparency, so a diagram saved as-is is invisible on any
 * white background — including when the file itself is opened. Both are fixed once here rather
 * than worked around by everything that displays it.
 */
export function normaliseSvg(svg: string): string {
  // Only the opening <svg> tag is touched. Stripping width and height everywhere also strips
  // them from the rects that draw the nodes, which leaves a diagram of arrows pointing at
  // nothing — the shapes are sized by those attributes.
  return svg.replace(/<svg\b[^>]*>/, (openingTag) => {
    const cleaned = openingTag
      .replace(/\s(?:width|height)="[^"]*"/g, '')
      .replace(/\sstyle="[^"]*"/g, '')
      .replace(/>$/, '')

    return (
      `${cleaned} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">` +
      `<rect width="100%" height="100%" fill="${MERMAID_THEME.background}"/>`
    )
  })
}
