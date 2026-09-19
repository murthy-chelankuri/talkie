import { renderMermaid } from './renderMermaid'
import { sceneClient } from '../api/projectClient'
import type { TimelineItem } from '../api/projectClient'

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
  timeline: TimelineItem[]
): Promise<number> {
  const waiting = timeline.filter((item) => {
    if (item.kind !== 'diagram') return false
    const data = item.data as { source?: string; src?: string } | null
    return Boolean(data?.source?.trim()) && !data?.src
  })

  let drawn = 0
  for (const item of waiting) {
    const data = item.data as { source: string; title?: string; style?: unknown }
    try {
      const { svg } = await renderMermaid(data.source)
      const src = await sceneClient.saveSvg(projectId, svg)
      await sceneClient.update(projectId, item.id, { ...data, src })
      drawn += 1
    } catch (err) {
      // Left as it is, source and all. Whoever wrote it can see what they wrote and fix it.
      console.error(`Could not draw the diagram on clip ${item.id}:`, err)
    }
  }

  return drawn
}
