/**
 * Turn mermaid source into an SVG, here in the app rather than in the export renderer.
 *
 * Mermaid is a large browser library, and having the export run it would make rendering slow
 * and, worse, allow the exported video to draw a diagram differently from the one that was
 * approved in the preview. Drawing it once and keeping the SVG means both show the same thing.
 */

/** Colours taken from the app's own palette, so a diagram looks made by Talkie. */
const THEME = {
  background: '#171b22',
  primaryColor: '#232833',
  primaryTextColor: '#f4f6f9',
  primaryBorderColor: '#d3a24c',
  lineColor: '#8a93a6',
  secondaryColor: '#2b313c',
  tertiaryColor: '#1b1f27',
  fontFamily: 'Geist Variable, ui-sans-serif, system-ui, sans-serif',
  fontSize: '20px'
}

let initialised = false

export interface DiagramResult {
  svg: string
}

export async function renderMermaid(source: string): Promise<DiagramResult> {
  const trimmed = source.trim()
  if (!trimmed) throw new Error('There is no diagram to draw yet.')

  const mermaid = (await import('mermaid')).default

  if (!initialised) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: THEME,
      flowchart: { curve: 'basis', padding: 18 }
    })
    initialised = true
  }

  // A syntax error throws with a readable message; it is passed straight to the user, who is
  // the one writing the source.
  const id = `talkie-diagram-${Math.random().toString(36).slice(2)}`
  const { svg } = await mermaid.render(id, trimmed)

  return { svg: normaliseSvg(svg) }
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
      `<rect width="100%" height="100%" fill="${THEME.background}"/>`
    )
  })
}

/** Whether mermaid can parse this at all, for telling the user before they wait on a render. */
export async function checkMermaid(source: string): Promise<string | null> {
  try {
    await renderMermaid(source)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
