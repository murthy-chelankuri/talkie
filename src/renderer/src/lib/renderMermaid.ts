import { MERMAID_CONFIG, normaliseSvg } from '../../../main/slides/mermaidTheme'

/**
 * Turn mermaid source into an SVG, here in the app rather than in the export renderer.
 *
 * Mermaid is a large browser library, and having the export run it would make rendering slow
 * and, worse, allow the exported video to draw a diagram differently from the one that was
 * approved in the preview. Drawing it once and keeping the SVG means both show the same thing.
 */

let initialised = false

export interface DiagramResult {
  svg: string
}

export async function renderMermaid(source: string): Promise<DiagramResult> {
  const trimmed = source.trim()
  if (!trimmed) throw new Error('There is no diagram to draw yet.')

  const mermaid = (await import('mermaid')).default

  if (!initialised) {
    mermaid.initialize(MERMAID_CONFIG)
    initialised = true
  }

  // A syntax error throws with a readable message; it is passed straight to the user, who is
  // the one writing the source.
  const id = `talkie-diagram-${Math.random().toString(36).slice(2)}`
  const { svg } = await mermaid.render(id, trimmed)

  return { svg: normaliseSvg(svg) }
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
