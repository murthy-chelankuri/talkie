import { renderMermaid } from './renderMermaid'
import { sceneClient } from '../api/projectClient'
import type { TimelineItem } from '../api/projectClient'
import type { RenderTheme } from '../../../remotion/renderTheme'
import { diagramStamp, diagramVariant, staleDiagrams } from '../../../main/themes/diagrams'

/**
 * Draw any diagram that arrived without a drawing.
 *
 * Not the usual path any more: an agent draws its own diagrams now, in the headless browser
 * the MCP server already has. This is the net underneath — a diagram written before that
 * existed, or one whose drawing was lost with the file it lived in, would otherwise sit on the
 * timeline showing nothing at all.
 *
 * Source is the thing that is stored and the SVG is derived from it, which is the order the
 * scene editor works in too; this only applies it to work that arrived from elsewhere.
 *
 * Returns how many were drawn, so the caller knows whether to re-read the timeline. Failures are
 * per diagram: source that mermaid cannot parse is the author's to fix, and it must not stop the
 * one after it being drawn.
 */
export async function drawPendingDiagrams(
  projectId: string,
  timeline: TimelineItem[],
  // Also redraws any diagram drawn in a theme other than the project's — see diagrams.ts.
  theme: RenderTheme | null = null
): Promise<number> {
  let drawn = 0
  for (const item of staleDiagrams(timeline, theme)) {
    const data = item.data as { source: string; title?: string; style?: unknown; themeStamp?: string }
    const variant = diagramVariant(data)
    try {
      const { svg } = await renderMermaid(data.source, theme, variant)
      const src = await sceneClient.saveSvg(projectId, svg)
      const { themeStamp: _old, ...rest } = data
      await sceneClient.update(projectId, item.id, {
        ...rest,
        src,
        ...(theme ? { themeStamp: diagramStamp(theme, variant) } : {})
      })
      drawn += 1
    } catch (err) {
      // Left as it is, source and all. Whoever wrote it can see what they wrote and fix it.
      console.error(`Could not draw the diagram on clip ${item.id}:`, err)
    }
  }

  return drawn
}
