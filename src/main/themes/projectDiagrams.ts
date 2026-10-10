import { homedir } from 'os'
import { openProject, readTimeline, updateSceneData, writeDiagramSvg } from '../project/projectApi'
import { renderMermaidHeadless } from '../slides/renderMermaidHeadless'
import { toRenderTheme } from './toRenderTheme'
import { diagramStamp, diagramVariant, staleDiagrams } from './diagrams'

/**
 * Draw a diagram as its project's theme has it, and say which theme that was.
 *
 * The one place in main that draws for a project — MCP's diagram tools and the redraw before an
 * export both come here — so a diagram is never drawn in one theme and stamped with another.
 */
export async function drawDiagramForProject(
  projectId: string,
  source: string,
  data: unknown,
  baseDir: string = homedir()
): Promise<{ svg: string; themeStamp?: string }> {
  const theme = toRenderTheme(openProject(projectId, baseDir).themeId, baseDir)
  const variant = diagramVariant(data)
  const svg = await renderMermaidHeadless(source, theme, variant)
  return theme ? { svg, themeStamp: diagramStamp(theme, variant) } : { svg }
}

/**
 * Redraw every diagram whose picture no longer matches the project's theme. Run before an export
 * so a theme changed since the project was last open is the one the video shows. A diagram that
 * cannot be drawn keeps the picture it had: its source is its author's to fix, and an export is
 * not the place to fail over it.
 */
export async function redrawStaleDiagrams(projectId: string, baseDir: string = homedir()): Promise<number> {
  const theme = toRenderTheme(openProject(projectId, baseDir).themeId, baseDir)
  let drawn = 0

  for (const item of staleDiagrams(readTimeline(projectId, baseDir), theme)) {
    const data = item.data as { source: string; themeStamp?: string }
    try {
      const { svg, themeStamp } = await drawDiagramForProject(projectId, data.source, data, baseDir)
      const { themeStamp: _old, ...rest } = data
      updateSceneData(
        projectId,
        item.id,
        { ...rest, src: writeDiagramSvg(projectId, svg, baseDir), ...(themeStamp ? { themeStamp } : {}) },
        baseDir
      )
      drawn += 1
    } catch (err) {
      console.error(`Could not redraw the diagram on clip ${item.id}:`, err)
    }
  }
  return drawn
}
