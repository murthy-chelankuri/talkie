import { homedir } from 'os'
import { dirname, join } from 'path'
import {
  DEFAULT_SCENE_DURATION_FRAMES,
  addTimelineItem,
  moveTimelineItem,
  openProject,
  readTimeline,
  readTranscript,
  updateSceneData
} from '../project/projectApi'
import { projectsRootDir } from '../project/paths'
import { withHistory } from '../project/history'
import { HtmlSceneDataSchema, type HtmlSceneData, type TimelineItem } from '../project/timeline/schema'
import { beatsByItem } from '../transcript/captions'
import { toRenderTheme } from '../themes/toRenderTheme'
import type { RenderTheme } from '../../remotion/renderTheme'
import { checkHtmlScene, sceneThemeFor, type CheckResult } from './check'
import { importScene } from './import'
import { readRevision, writeRevision } from './store'

/**
 * HTML scenes as the app, the in-app agent and outside agents all handle them: one place that
 * writes a revision, puts the clip on the timeline as one undo step, and checks what was made.
 */

export interface HtmlSceneInput {
  title?: string
  /** Files to write, by path inside the scene — usually just index.html. */
  files?: Record<string, string>
  removeFiles?: string[]
  /** An .html file or a folder to copy in. */
  importPath?: string
  params?: Record<string, unknown>
  style?: { theme?: 'brand' | 'light' | 'dark' }
  prompt?: string
  durationFrames?: number
  /** Where on the timeline, counting from 1 as talkie_timeline lists clips. The end when absent. */
  position?: number
}

export interface HtmlSceneOutcome {
  item: TimelineItem
  check: CheckResult
  warnings: string[]
}

/** What a poster was drawn for: its revision, the theme and the variant. Any change means a new one. */
export function posterStampFor(data: HtmlSceneData, theme: RenderTheme | null): string {
  return `${dirname(data.src)}:${theme?.stamp ?? 'none'}:${data.style.theme}`
}

function sceneItem(projectId: string, itemId: string, baseDir: string): TimelineItem & { data: HtmlSceneData } {
  const item = readTimeline(projectId, baseDir).find((candidate) => candidate.id === itemId)
  if (!item) throw new Error(`No clip found with id ${itemId}.`)
  if (item.kind !== 'html') throw new Error(`That clip is a ${item.kind}, not an HTML scene.`)
  return { ...item, data: HtmlSceneDataSchema.parse(item.data) }
}

/**
 * Check the scene as it stands, write its poster, and record what the check found on the clip.
 * Not an undo step of its own: it records what the action before it produced.
 */
async function checkAndRecord(projectId: string, itemId: string, atSeconds: number[] | undefined, baseDir: string): Promise<{ item: TimelineItem; check: CheckResult }> {
  const item = sceneItem(projectId, itemId, baseDir)
  const theme = toRenderTheme(openProject(projectId, baseDir).themeId, baseDir)
  const beats = (beatsByItem(readTranscript(projectId, baseDir))[itemId] ?? []).map((beat) => beat.at)
  const check = await checkHtmlScene({
    src: item.data.src,
    durationFrames: item.duration,
    params: item.data.params,
    theme: sceneThemeFor(theme, item.data.style.theme),
    beats,
    atSeconds,
    posterTo: join(dirname(item.data.src), 'poster.png'),
    rootDir: projectsRootDir(baseDir)
  })
  const updated = updateSceneData(
    projectId,
    itemId,
    {
      ...item.data,
      posterStamp: posterStampFor(item.data, theme),
      posterText: check.visibleText,
      check: { problems: check.problems }
    },
    baseDir
  )
  return { item: updated, check }
}

export async function addHtmlScene(
  projectId: string,
  input: HtmlSceneInput & { title: string },
  baseDir: string = homedir()
): Promise<HtmlSceneOutcome> {
  let warnings: string[] = []
  const item = withHistory(
    projectId,
    () => {
      let src: string
      if (input.importPath) {
        const imported = importScene(projectId, input.importPath, baseDir)
        src = imported.src
        warnings = imported.warnings
      } else {
        src = writeRevision(projectId, input.files ?? {}, { baseDir })
      }
      const timeline = readTimeline(projectId, baseDir)
      const start = timeline.length === 0 ? 0 : Math.max(...timeline.map((clip) => clip.start + clip.duration))
      const data = HtmlSceneDataSchema.parse({
        src,
        title: input.title,
        style: input.style ?? {},
        params: input.params ?? {},
        ...(input.prompt ? { prompt: input.prompt } : {})
      })
      const added = addTimelineItem(projectId, { kind: 'html', start, duration: input.durationFrames ?? DEFAULT_SCENE_DURATION_FRAMES, data }, baseDir)
      if (input.position !== undefined) moveTimelineItem(projectId, added.id, input.position, baseDir)
      return added
    },
    baseDir
  )
  const checked = await checkAndRecord(projectId, item.id, undefined, baseDir)
  return { ...checked, warnings }
}

export async function editHtmlScene(
  projectId: string,
  itemId: string,
  input: HtmlSceneInput,
  baseDir: string = homedir()
): Promise<HtmlSceneOutcome> {
  const current = sceneItem(projectId, itemId, baseDir)
  const changesFiles = Object.keys(input.files ?? {}).length > 0 || (input.removeFiles?.length ?? 0) > 0
  withHistory(
    projectId,
    () => {
      const src = changesFiles
        ? writeRevision(projectId, input.files ?? {}, { from: current.data.src, remove: input.removeFiles, baseDir })
        : current.data.src
      updateSceneData(
        projectId,
        itemId,
        HtmlSceneDataSchema.parse({
          ...current.data,
          src,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
          params: input.params ?? current.data.params,
          style: { ...current.data.style, ...input.style }
        }),
        baseDir
      )
      if (input.position !== undefined) moveTimelineItem(projectId, itemId, input.position, baseDir)
    },
    baseDir
  )
  return { ...(await checkAndRecord(projectId, itemId, undefined, baseDir)), warnings: [] }
}

export function readHtmlScene(
  projectId: string,
  itemId: string,
  baseDir: string = homedir()
): { item: TimelineItem; data: HtmlSceneData; files: ReturnType<typeof readRevision> } {
  const item = sceneItem(projectId, itemId, baseDir)
  return { item, data: item.data, files: readRevision(item.data.src) }
}

/** Frames of the scene at the moments asked for, for an agent or the editor to look at. */
export async function checkSceneItem(
  projectId: string,
  itemId: string,
  atSeconds?: number[],
  baseDir: string = homedir()
): Promise<CheckResult> {
  return (await checkAndRecord(projectId, itemId, atSeconds, baseDir)).check
}

/**
 * Posters drawn for another revision, theme or variant, drawn again — on opening a project and
 * before an export, as diagrams are. A scene whose page will not load keeps the poster it had.
 */
export async function redrawStalePosters(projectId: string, baseDir: string = homedir()): Promise<number> {
  const theme = toRenderTheme(openProject(projectId, baseDir).themeId, baseDir)
  let redrawn = 0
  for (const item of readTimeline(projectId, baseDir)) {
    if (item.kind !== 'html') continue
    const data = HtmlSceneDataSchema.parse(item.data)
    if (data.posterStamp === posterStampFor(data, theme)) continue
    try {
      await checkAndRecord(projectId, item.id, [], baseDir)
      redrawn++
    } catch (err) {
      console.error(`Could not redraw the poster for HTML scene ${item.id}:`, err)
    }
  }
  return redrawn
}
