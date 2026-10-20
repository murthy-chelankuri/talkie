import { join } from 'path'
import { homedir } from 'os'
import { writeJsonAtomic } from '../project/atomicWrite'
import { findProjectDir } from '../project/paths'
import {
  DEFAULT_SCENE_DURATION_FRAMES,
  addTimelineItem,
  moveTimelineItem,
  openProject,
  readTimeline,
  replaceClipContent
} from '../project/projectApi'
import { ProjectMetadataSchema, type ProjectMetadata } from '../project/schema'
import { HtmlSceneDataSchema, TextSceneDataSchema, type TimelineItem } from '../project/timeline/schema'
import { richTextToPlain } from '../project/timeline/richText'
import { VARIANT_FOR } from '../../composition/sceneTheme'
import { writeRevision } from '../htmlScene/store'
import { templateFiles } from '../htmlScene/templates'
import { readTheme } from './themeApi'
import type { Theme } from './schema'

type Card = 'opening' | 'closing'

/**
 * Give a project a theme, or take it away.
 *
 * The first time a project gets one, it also gets an opening card and a closing card — HTML
 * scenes from the `opening` and `closing` templates, so they can be reworded, narrated, retimed
 * or deleted like any other scene. Only the first time: someone who deleted the cards meant it,
 * and a project that swaps themes restyles the cards it has rather than collecting a pair per
 * theme. What the cards say of the company — its name, tagline and website — and their logo are
 * read from the theme as they are drawn, so a new theme changes those too. Removing the theme
 * leaves them, because by then they are the project's clips, not the theme's.
 *
 * Cards from before they were HTML — classic slides with the title or closing layout — are made
 * HTML cards whenever a theme is applied, keeping their words, place, length and narration.
 */
export function setProjectTheme(projectId: string, themeId: string | null, baseDir: string = homedir()): ProjectMetadata {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) throw new Error(`No project found with id ${projectId}`)

  const theme = themeId ? readTheme(themeId, baseDir) : null
  const project = openProject(projectId, baseDir)

  if (theme) {
    // What a classic closing card said by itself: the tagline or company of the theme that made
    // it — which may not be this one — or else the project's name.
    const defaults = new Set([project.name, ...[theme, previousTheme(project, baseDir)].flatMap((t) => (t ? [t.tagline, t.company] : []))].filter(Boolean))
    for (const item of readTimeline(projectId, baseDir)) {
      const classic = classicCard(item)
      if (classic) remakeAsHtmlCard(projectId, item, classic, defaults, baseDir)
    }
  }

  // And never beside cards it already has, whatever the project file says about them.
  const hasCards = readTimeline(projectId, baseDir).some((item) => HtmlSceneDataSchema.safeParse(item.data).data?.card)
  const addBookends = theme !== null && !project.bookendsAdded && !hasCards
  if (addBookends) {
    const opening = addHtmlCard(projectId, 'opening', project.name, baseDir)
    moveTimelineItem(projectId, opening.id, 1, baseDir)
    // Left untitled, the closing card leads with whatever tagline the theme has when it is drawn.
    addHtmlCard(projectId, 'closing', '', baseDir)
  }

  const next = ProjectMetadataSchema.parse({
    ...project,
    themeId: theme?.id,
    ...(addBookends ? { bookendsAdded: true } : {})
  })
  writeJsonAtomic(join(dir, 'project.json'), next)
  return next
}

function cardData(projectId: string, card: Card, title: string, variant: 'brand' | 'light' | 'dark', baseDir: string): unknown {
  return HtmlSceneDataSchema.parse({
    src: writeRevision(projectId, templateFiles(card), { baseDir }),
    title: card === 'opening' ? 'Opening card' : 'Closing card',
    style: { theme: variant },
    params: { title },
    card
  })
}

function addHtmlCard(projectId: string, card: Card, title: string, baseDir: string): TimelineItem {
  const timeline = readTimeline(projectId, baseDir)
  const start = timeline.length === 0 ? 0 : Math.max(...timeline.map((clip) => clip.start + clip.duration))
  return addTimelineItem(
    projectId,
    { kind: 'html', start, duration: DEFAULT_SCENE_DURATION_FRAMES, data: cardData(projectId, card, title, 'brand', baseDir) },
    baseDir
  )
}

/** Which card a classic slide is, or null for any other clip. */
function classicCard(item: TimelineItem): Card | null {
  if (item.kind !== 'scene') return null
  const layout = TextSceneDataSchema.safeParse(item.data).data?.layout
  return layout === 'title' ? 'opening' : layout === 'closing' ? 'closing' : null
}

function previousTheme(project: ProjectMetadata, baseDir: string): Theme | null {
  try {
    return project.themeId ? readTheme(project.themeId, baseDir) : null
  } catch {
    // Deleted from the library since: its words cannot be told apart, so they are kept.
    return null
  }
}

/**
 * A classic card as an HTML one, in place. Its words are kept — except a closing card that only
 * ever said what it was given by default, which is left untitled so it goes on following the
 * theme rather than holding on to the old one's words.
 */
function remakeAsHtmlCard(projectId: string, item: TimelineItem, card: Card, defaults: Set<string>, baseDir: string): void {
  const data = TextSceneDataSchema.parse(item.data)
  const words = richTextToPlain(data.title).trim()
  const fromTheme = card === 'closing' && defaults.has(words)
  const variant = VARIANT_FOR[data.style.theme as keyof typeof VARIANT_FOR] ?? 'brand'
  replaceClipContent(projectId, item.id, 'html', cardData(projectId, card, fromTheme ? '' : words, variant, baseDir), baseDir)
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
