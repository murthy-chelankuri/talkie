/**
 * How a Talkie diagram looks, and how its SVG is made fit to show.
 *
 * Shared rather than copied because a diagram can now be drawn in two places — in the window,
 * on Chromium's own canvas, and in the MCP server, in a headless browser — and the one thing
 * that must not differ between them is the result. A diagram that renders differently
 * depending on who asked for it is worse than one that cannot be drawn at all.
 */

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
