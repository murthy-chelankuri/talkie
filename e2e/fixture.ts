import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import {
  addScene,
  addTimelineItem,
  addTranscriptSegment,
  createProject,
  updateTranscriptSegmentAudio
} from '../src/main/project/projectApi'
import { h264, runFfmpeg } from '../src/main/media'
import { updateSettings } from '../src/main/settings/settingsStore'
import { isKokoroDownloaded, kokoroCacheDir } from '../src/main/tts/kokoro/kokoroModel'
import { addHtmlScene } from '../src/main/htmlScene/htmlSceneApi'
import { templateFiles } from '../src/main/htmlScene/templates'
import { projectsRootDir } from '../src/main/project/paths'

export const PROJECT_NAME = 'End to end'

/** The narration each slide starts with. The last is left unwritten on purpose. */
export const SCRIPT = [
  'Talkie turns a recording into a narrated video.',
  '[0.5] Every scene has its own words.\n[2.5] And its own voice.'
]

/**
 * The line Kokoro once read as five seconds of nothing, in the voice it did it in. A scene lost
 * its first sentence and nobody heard it until the video was watched; it stays here so that if
 * the model ever does it again, the run hears it first.
 */
export const KOKORO_SILENT_LINE =
  'A brain sitting on a circuit board, lit up in neon, with the letters A and I glowing beside it.'
export const KOKORO_VOICE = 'af_alloy'

export type Fixture = { home: string; projectId: string; dispose: () => void }

/**
 * A throwaway home folder holding one project, built through the same functions the app uses.
 *
 * The app reads everything from `~/Talkie`, so pointing HOME here is what keeps a run away from
 * the person's own projects and — more to the point — their settings, which hold API keys.
 */
/**
 * Options for a fixture. Kokoro is the only speech engine now, so the choice that used to be
 * "which engine" is "does this run borrow the downloaded voice". Off by default — that is a fresh
 * install, the voice offered but not yet on disk, which is what the tests that are not about
 * speaking want. A test that voices a scene turns it on and skips itself where there is no model.
 */
export type FixtureOptions = { kokoro?: boolean }

export function makeFixture(options: FixtureOptions = {}): Fixture {
  return buildFixture(options)
}

/**
 * The fixture with an HTML scene after the slides, for what only a web page in a frame can show.
 * Async because a scene is checked in a headless browser before it is added.
 */
export async function makeFixtureWithHtmlScene(): Promise<Fixture> {
  const fixture = buildFixture({})
  await addHtmlScene(
    fixture.projectId,
    { title: 'Kinetic', files: templateFiles('kinetic-title') as Record<string, string>, params: { title: 'In a frame', subtitle: HTML_SCENE_SUBTITLE } },
    fixture.home
  )
  return fixture
}

/** What the HTML scene says, to find it drawn. */
export const HTML_SCENE_SUBTITLE = 'Drawn by a web page'

/** Where the cut fixture's recording ends and its narrated slide begins, in frames. */
export const CUT_FRAME = 90

/**
 * A recording cut straight to a slide with a spoken take: the one moment in a preview when a
 * <video> stops and an <audio> has to start on time. The footage and the take are made with
 * Talkie's own ffmpeg — a moving test pattern, so a frame off is a different picture, and a tone.
 */
export async function makeFixtureWithCut(): Promise<Fixture> {
  const home = mkdtempSync(join(tmpdir(), 'talkie-e2e-'))
  // The take here is a tone written straight to disk, not synthesised, so the engine setting is
  // cosmetic — Kokoro, like the rest of the app, without borrowing the model.
  updateSettings({ speech: { engine: 'kokoro' }, narration: { autoDraft: false } }, home)
  const project = createProject(PROJECT_NAME, home)
  const root = projectsRootDir(home)
  const dir = join(root, readdirSync(root).find((entry) => entry.startsWith(project.id))!)

  const clip = join(dir, 'sources', 'cut', 'clip.mp4')
  mkdirSync(join(dir, 'sources', 'cut'), { recursive: true })
  await runFfmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4', ...(await h264('intermediate')), '-pix_fmt', 'yuv420p', '-y', clip])
  addTimelineItem(project.id, { kind: 'video', start: 0, duration: CUT_FRAME, data: { src: clip, trimBefore: 0 } }, home)

  const slide = addScene(project.id, 'scene', { title: 'After the cut', bullets: ['Spoken over'] }, home)
  const segment = addTranscriptSegment(project.id, { text: 'Spoken over the slide.', timelineItemId: slide.id }, home)
  mkdirSync(join(dir, 'audio'), { recursive: true })
  await runFfmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '48000', '-y', join(dir, 'audio', 'take.wav')])
  updateTranscriptSegmentAudio(project.id, segment.id, 'take.wav', 'tone', home)

  return { home, projectId: project.id, dispose: () => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
}

function buildFixture({ kokoro = false }: FixtureOptions): Fixture {
  const home = mkdtempSync(join(tmpdir(), 'talkie-e2e-'))
  updateSettings(
    { speech: kokoro ? { engine: 'kokoro', voice: KOKORO_VOICE } : { engine: 'kokoro' }, narration: { autoDraft: false } },
    home
  )

  // The Kokoro weights are hundreds of megabytes and pinned by hash, so a run that voices a scene
  // borrows the copy already downloaded rather than fetching its own. Only the model folder is
  // shared; a run that does not speak leaves the home without it, as a fresh install is.
  if (kokoro) symlinkSync(kokoroCacheDir(homedir()), kokoroCacheDir(home))

  // Playwright keeps its browsers under ~/Library/Caches, and export renders with its headless
  // shell when it finds one there. Without this the run would export through a full Chrome —
  // three times slower, and not what anyone with Playwright's browsers installed gets.
  const browsers = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  if (existsSync(browsers)) {
    mkdirSync(join(home, 'Library', 'Caches'), { recursive: true })
    symlinkSync(browsers, join(home, 'Library', 'Caches', 'ms-playwright'))
  }

  const script = kokoro ? [KOKORO_SILENT_LINE, SCRIPT[1]] : SCRIPT
  const project = createProject(PROJECT_NAME, home)
  for (const [index, title] of ['Welcome', 'How it works', 'The end'].entries()) {
    const item = addScene(project.id, 'scene', { title, bullets: ['One point', 'Another'] }, home)
    if (script[index]) addTranscriptSegment(project.id, { text: script[index], timelineItemId: item.id }, home)
  }
  return { home, projectId: project.id, dispose: () => rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
}

/** Whether this machine has the Kokoro model to borrow. */
export function kokoroAvailable(): boolean {
  return isKokoroDownloaded(homedir())
}
