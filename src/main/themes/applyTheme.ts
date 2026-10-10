import { join } from 'path'
import { homedir } from 'os'
import { writeJsonAtomic } from '../project/atomicWrite'
import { findProjectDir } from '../project/paths'
import { addScene, moveTimelineItem, openProject } from '../project/projectApi'
import { ProjectMetadataSchema, type ProjectMetadata } from '../project/schema'
import { readTheme } from './themeApi'

/**
 * Give a project a theme, or take it away.
 *
 * The first time a project gets one, it also gets an opening card and a closing card — ordinary
 * slides, so they can be reworded, narrated, retimed or deleted like any other clip. Only the
 * first time: someone who deleted the cards meant it, and a project that swaps themes should
 * restyle the cards it has rather than collect a pair per theme. Removing the theme leaves them,
 * because by then they are the project's clips, not the theme's.
 */
export function setProjectTheme(projectId: string, themeId: string | null, baseDir: string = homedir()): ProjectMetadata {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) throw new Error(`No project found with id ${projectId}`)

  const theme = themeId ? readTheme(themeId, baseDir) : null
  const project = openProject(projectId, baseDir)

  const addBookends = theme !== null && !project.bookendsAdded
  if (addBookends) {
    const card = { bullets: [], style: { theme: 'brand', align: 'center' } }
    const opening = addScene(projectId, 'scene', { ...card, title: project.name, layout: 'title' }, baseDir)
    moveTimelineItem(projectId, opening.id, 1, baseDir)
    addScene(
      projectId,
      'scene',
      { ...card, title: theme.tagline || theme.company || project.name, layout: 'closing' },
      baseDir
    )
  }

  const next = ProjectMetadataSchema.parse({
    ...project,
    themeId: theme?.id,
    ...(addBookends ? { bookendsAdded: true } : {})
  })
  writeJsonAtomic(join(dir, 'project.json'), next)
  return next
}

/** The click highlight the project's theme asks for, or null to use the one in Settings. */
export function themeHighlight(projectId: string, baseDir: string = homedir()): string | null {
  try {
    const themeId = openProject(projectId, baseDir).themeId
    return themeId ? readTheme(themeId, baseDir).overlays.highlight : null
  } catch {
    // A theme deleted from under the project: record with the app's colour rather than fail.
    return null
  }
}
