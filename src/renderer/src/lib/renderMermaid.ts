import { diagramBackground, mermaidConfigFor, normaliseSvg } from '../../../main/slides/mermaidTheme'
import { fontFaceCss, type RenderTheme } from '../../../remotion/renderTheme'
import type { VariantId } from '../../../main/themes/schema'

/**
 * Turn mermaid source into an SVG, here in the app rather than in the export renderer.
 *
 * Mermaid is a large browser library, and having the export run it would make rendering slow
 * and, worse, allow the exported video to draw a diagram differently from the one that was
 * approved in the preview. Drawing it once and keeping the SVG means both show the same thing.
 */

/** Which configuration mermaid was last set up with; it keeps one at a time. */
let initialisedFor: string | null = null

/**
 * The theme's faces, in this window, before mermaid measures any text with them — it sizes each
 * box to its label, so drawing in a font that has not arrived yet lays the diagram out wrong.
 */
async function loadThemeFonts(theme: RenderTheme): Promise<void> {
  const id = `talkie-theme-fonts-${theme.stamp}`
  if (!document.getElementById(id)) {
    const style = document.createElement('style')
    style.id = id
    style.textContent = fontFaceCss(theme)
    document.head.appendChild(style)
  }
  if (theme.fonts.body.urls.length > 0) {
    await document.fonts.load(`1em "${theme.fonts.body.family.replace(/"/g, '')}"`).catch(() => undefined)
  }
}

export interface DiagramResult {
  svg: string
}

export async function renderMermaid(
  source: string,
  theme: RenderTheme | null = null,
  variant: VariantId = 'dark'
): Promise<DiagramResult> {
  const trimmed = source.trim()
  if (!trimmed) throw new Error('There is no diagram to draw yet.')

  const mermaid = (await import('mermaid')).default

  const key = theme ? `${theme.stamp}:${variant}` : 'talkie'
  if (initialisedFor !== key) {
    if (theme) await loadThemeFonts(theme)
    mermaid.initialize(mermaidConfigFor(theme, variant))
    initialisedFor = key
  }

  // A syntax error throws with a readable message; it is passed straight to the user, who is
  // the one writing the source.
  const id = `talkie-diagram-${Math.random().toString(36).slice(2)}`
  const { svg } = await mermaid.render(id, trimmed)

  return { svg: normaliseSvg(svg, diagramBackground(theme, variant)) }
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
