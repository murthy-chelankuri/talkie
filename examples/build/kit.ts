import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import {
  addScene,
  addTimelineItem,
  addTranscriptSegment,
  createProject,
  deleteTimelineItem,
  moveTimelineItem,
  readTimeline,
  readTranscript,
  sweepUnusedNarrationAudio,
  updateSceneData,
  writeDiagramSvg
} from '../../src/main/project/projectApi'
import { findProjectDir } from '../../src/main/project/paths'
import { updateSettings } from '../../src/main/settings/settingsStore'
import { isKokoroDownloaded, kokoroCacheDir } from '../../src/main/tts/kokoro/kokoroModel'
import { setProjectTheme } from '../../src/main/themes/applyTheme'
import { drawDiagramForProject } from '../../src/main/themes/projectDiagrams'
import { addHtmlScene } from '../../src/main/htmlScene/htmlSceneApi'
import { templateFiles } from '../../src/main/htmlScene/templates'
import { narrateSegment } from '../../src/main/transcript/narrate'
import { narrationFromText } from '../../src/main/transcript/narrationBeats'
import { PROJECT_DIR_TOKEN } from '../../src/main/examples/installExamples'
import { startRecordingSession } from '../../src/main/capture/recordSession'
import { importRecordedSession } from '../../src/main/capture/importRecordedSession'
import { readActionLog } from '../../src/main/capture/actionLog'
import { VIDEO_TIME_LOG } from '../../src/main/capture/rebaseActionLog'
import { takeShape } from '../../e2e/audio'
import type { Page } from 'playwright'
import type { TimelineItem } from '../../src/main/project/timeline/schema'
import { FPS } from '../../src/composition/constants'
import type { Cut } from './tour/cutFootage'

/**
 * What the example stories are built with: the same functions the app and its agents use, so an
 * example is exactly the project someone would have made by hand — nothing in one that the editor
 * could not open, change and voice again.
 */

/** The voice every example speaks in. Warm, unhurried, and the default Kokoro offers. */
export const EXAMPLE_VOICE = 'af_heart'

/** How fast Kokoro reads, near enough, to space a timed take's lines before it is spoken. */
const WORDS_PER_SECOND = 2.7
/** The breath left between one line and the next. */
const LINE_GAP_SECONDS = 0.45

/** Where the built examples go, and where the app installs them from. */
export const EXAMPLES_DIR = join(__dirname, '..', 'projects')

export type Story = {
  id: string
  name: string
  /** Lower first in the project browser. */
  order: number
  /** Raise when a rebuilt example is worth a fresh copy for people who have the old one. */
  version: number
  build: (project: StoryProject) => Promise<void>
}

export function kokoroAvailable(): boolean {
  return isKokoroDownloaded(homedir())
}

/**
 * Narration with a timing on every line, so slides bring each point in as it is said and diagrams
 * draw each box as it is named. Each line is given room for its own words before the next starts;
 * the voice waits where a line is short, and never starts one before the last has finished.
 */
export function timed(...lines: string[]): string {
  let at = 0.2
  return lines
    .map((line) => {
      const stamped = `[${at.toFixed(1)}] ${line}`
      at += line.split(/\s+/).length / WORDS_PER_SECOND + LINE_GAP_SECONDS
      return stamped
    })
    .join('\n')
}

type Look = 'brand' | 'light' | 'dark'

/** One scene of a recording: what is done in it, and what is said over it. */
export type RecordedScene = { narration: string; act?: (page: Page) => Promise<void> }

export class StoryProject {
  readonly clips: string[] = []

  constructor(
    readonly id: string,
    readonly home: string
  ) {}

  /** Give the project a built-in theme. The first one adds opening and closing cards. */
  theme(slug: string): { opening: TimelineItem; closing: TimelineItem } {
    setProjectTheme(this.id, `builtin-${slug}`, this.home)
    const timeline = readTimeline(this.id, this.home)
    return { opening: timeline[0], closing: timeline[timeline.length - 1] }
  }

  /** Reword one of the theme's cards and give it its narration. */
  card(item: TimelineItem, title: string, narration: string): void {
    updateSceneData(this.id, item.id, { ...(item.data as object), title }, this.home)
    this.say(item.id, narration)
  }

  slide(title: string, bullets: string[], narration: string, style: { theme?: Look; align?: 'left' | 'center' } = {}): string {
    const item = addScene(this.id, 'scene', { title, bullets, style }, this.home)
    return this.place(item.id, narration)
  }

  async diagram(title: string, source: string, narration: string, style: { theme?: Look } = {}): Promise<string> {
    const data = { source, title, style }
    const { svg, themeStamp } = await drawDiagramForProject(this.id, source, data, this.home)
    const item = addScene(
      this.id,
      'diagram',
      { ...data, src: writeDiagramSvg(this.id, svg, this.home), ...(themeStamp ? { themeStamp } : {}) },
      this.home
    )
    return this.place(item.id, narration)
  }

  /** An HTML scene from one of the templates, filled in with its parameters. */
  async html(template: string, title: string, params: Record<string, unknown>, narration: string): Promise<string> {
    const { item, check } = await addHtmlScene(
      this.id,
      { title, files: templateFiles(template) as Record<string, string>, params },
      this.home
    )
    // An example is the first thing anyone sees made in Talkie; one whose scene the check finds
    // fault with is not shipped.
    if (check.problems.length > 0) {
      throw new Error(`The ${template} scene "${title}" has problems: ${JSON.stringify(check.problems)}`)
    }
    return this.place(item.id, narration)
  }

  /**
   * A piece of filmed footage as a recording clip, with the clicks that happened in it beside it,
   * where a recording keeps them — so it leans in on each click as a real recording does.
   */
  footage(cut: Cut, narration: string): string {
    const dir = join(findProjectDir(this.id, this.home)!, 'sources', 'tour', basename(dirname(cut.path)))
    mkdirSync(dir, { recursive: true })
    for (const file of ['clip.mp4', 'actions.jsonl']) cpSync(join(dirname(cut.path), file), join(dir, file))
    const timeline = readTimeline(this.id, this.home)
    const item = addTimelineItem(
      this.id,
      {
        kind: 'video',
        start: timeline.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0),
        duration: Math.round(cut.seconds * FPS),
        data: { src: join(dir, 'clip.mp4') }
      },
      this.home
    )
    return this.place(item.id, narration)
  }

  /**
   * Record an app through Talkie's own recorder, one scene after another, and narrate each.
   *
   * Each scene is marked as it starts, as the toolbar's mark button does, and the recording is cut
   * at the marks rather than wherever the splitter would have cut it: a story's lines are written
   * for particular moments, and a scene that began a click early or late would describe the wrong
   * one. Every scene is held on screen for as long as its words should take, so a take never has
   * to borrow footage from the scene after it.
   */
  async recording(url: string, scenes: RecordedScene[]): Promise<string[]> {
    const session = await startRecordingSession(this.id, url, this.home)
    await session.page.waitForLoadState('networkidle')
    await session.page.waitForTimeout(1200)
    for (const scene of scenes) {
      session.markAnnotation('important')
      const started = Date.now()
      await scene.act?.(session.page)
      const wanted = (scene.narration.split(/\s+/).length / WORDS_PER_SECOND + 1.2) * 1000
      await session.page.waitForTimeout(Math.max(800, wanted - (Date.now() - started)))
    }
    const imported = await importRecordedSession(this.id, await session.stop(), this.home)

    const src = (imported[0].data as { src: string }).src
    const total = Math.max(
      ...imported.map((item) => (item.data as { trimAfter?: number }).trimAfter ?? ((item.data as { trimBefore?: number }).trimBefore ?? 0) + item.duration)
    )
    for (const item of imported) deleteTimelineItem(this.id, item.id, this.home)
    const marks = readActionLog(join(dirname(src), VIDEO_TIME_LOG))
      .filter((entry) => entry.type === 'annotation')
      .map((entry) => Math.round((entry.t / 1000) * FPS))
    if (marks.length !== scenes.length) throw new Error(`Recorded ${marks.length} scene marks for ${scenes.length} scenes`)

    // The stitched video is what plays; the stretches it was stitched from are only the build's.
    for (const file of readdirSync(dirname(src))) {
      if (file !== basename(src) && !file.endsWith('.jsonl')) rmSync(join(dirname(src), file), { recursive: true, force: true })
    }

    return scenes.map((scene, index) => {
      const from = marks[index]
      const to = marks[index + 1] ?? total
      const timeline = readTimeline(this.id, this.home)
      const item = addTimelineItem(
        this.id,
        {
          kind: 'video',
          start: timeline.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0),
          duration: to - from,
          data: { src, trimBefore: from, ...(to < total ? { trimAfter: to } : {}) }
        },
        this.home
      )
      return this.place(item.id, scene.narration)
    })
  }

  /** Send a clip to the end — the theme's closing card, once the scenes are in. */
  toEnd(clipId: string): void {
    moveTimelineItem(this.id, clipId, readTimeline(this.id, this.home).length, this.home)
  }

  private place(clipId: string, narration: string): string {
    this.say(clipId, narration)
    return clipId
  }

  private say(clipId: string, written: string): void {
    const { text, beats } = narrationFromText(written)
    addTranscriptSegment(this.id, { text, timelineItemId: clipId, beats }, this.home)
    this.clips.push(clipId)
  }
}

/**
 * A throwaway home for one build, as the end-to-end run makes for the app: settings that speak in
 * Kokoro, the model borrowed from the copy already downloaded, and nothing of the person's own.
 */
export function buildHome(): { home: string; dispose: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'talkie-examples-'))
  updateSettings({ speech: { engine: 'kokoro', voice: EXAMPLE_VOICE }, narration: { autoDraft: false } }, home)
  symlinkSync(kokoroCacheDir(homedir()), kokoroCacheDir(home))
  return { home, dispose: () => rmSync(home, { recursive: true, force: true }) }
}

export type BuiltStory = {
  dir: string
  takes: {
    clipId: string
    text: string
    seconds: number
    longestSilence: number
    /** Seconds the footage holds its last frame because the line is longer than the shot. */
    holdsFor?: number
  }[]
}

/** Build one story, voice every line of it, and check each take is a voice rather than silence. */
export async function buildStory(story: Story, home: string): Promise<BuiltStory> {
  const project = new StoryProject(createProject(story.name, home).id, home)
  await story.build(project)

  // How long each recording is before its narration stretches it, to say where a line outruns
  // its footage and the picture holds still.
  const footage = new Map(
    readTimeline(project.id, home)
      .filter((item) => item.kind === 'video')
      .map((item) => [item.id, item.duration / FPS])
  )

  const takes: BuiltStory['takes'] = []
  for (const segment of readTranscript(project.id, home)) {
    process.stderr.write(`voicing: ${segment.text.slice(0, 60)}\n`)
    const spoken = await narrateSegment(project.id, segment.id, home)
    const shape = takeShape(join(findProjectDir(project.id, home)!, 'audio', spoken.audioFile!))
    if (shape.rms < 0.01) throw new Error(`The take for "${segment.text}" is silent.`)
    // Timed takes wait between lines on purpose; anything near this long is a line gone missing.
    if (shape.longestSilence > 2.5) {
      throw new Error(`The take for "${segment.text}" has ${shape.longestSilence.toFixed(1)}s of silence in it.`)
    }
    const shown = footage.get(segment.timelineItemId)
    takes.push({
      clipId: segment.timelineItemId,
      text: segment.text,
      seconds: shape.seconds,
      longestSilence: shape.longestSilence,
      ...(shown !== undefined && shape.seconds > shown ? { holdsFor: shape.seconds - shown } : {})
    })
  }
  sweepUnusedNarrationAudio(project.id, home)
  return { dir: findProjectDir(project.id, home)!, takes }
}

/** What a project holds that is the example rather than something made by using it. */
const SHIPPED = ['project.json', 'timeline.json', 'transcript.json', 'audio', 'sources']

/**
 * Copy a built project into `examples/projects/<id>/`, with its own folder replaced by the token
 * the installer fills in. Clips record their media by absolute path, and the build's folder is a
 * temporary one on this machine.
 */
export function packageStory(story: Story, built: BuiltStory): string {
  const out = join(EXAMPLES_DIR, story.id)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(join(out, 'project'), { recursive: true })
  for (const entry of SHIPPED) {
    if (existsSync(join(built.dir, entry))) cpSync(join(built.dir, entry), join(out, 'project', entry), { recursive: true })
  }

  // The temporary folder is reached through /var on macOS and recorded through /private/var, or
  // the other way round, depending on who asked; both spellings are replaced.
  const spellings = [...new Set([realpathSync(built.dir), built.dir])].sort((a, b) => b.length - a.length)
  for (const file of ['timeline.json', 'transcript.json']) {
    const path = join(out, 'project', file)
    let content = readFileSync(path, 'utf-8')
    for (const spelling of spellings) content = content.split(spelling).join(PROJECT_DIR_TOKEN)
    if (content.includes(tmpdir()) || content.includes(realpathSync(tmpdir()))) {
      throw new Error(`${file} of ${story.id} still points into the build folder.`)
    }
    writeFileSync(path, content)
  }

  writeFileSync(
    join(out, 'example.json'),
    `${JSON.stringify({ id: story.id, name: story.name, version: story.version, order: story.order }, null, 2)}\n`
  )
  return out
}
