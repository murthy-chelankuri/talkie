import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { addScene, addTranscriptSegment, createProject } from '../src/main/project/projectApi'
import { updateSettings } from '../src/main/settings/settingsStore'
import { isKokoroDownloaded, kokoroCacheDir } from '../src/main/tts/kokoro/kokoroModel'
import type { SpeechEngineId } from '../src/main/settings/schema'
import { addHtmlScene } from '../src/main/htmlScene/htmlSceneApi'
import { templateFiles } from '../src/main/htmlScene/templates'

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
export function makeFixture(engine: SpeechEngineId = 'system'): Fixture {
  return buildFixture(engine)
}

/**
 * The fixture with an HTML scene after the slides, for what only a web page in a frame can show.
 * Async because a scene is checked in a headless browser before it is added.
 */
export async function makeFixtureWithHtmlScene(): Promise<Fixture> {
  const fixture = buildFixture('system')
  await addHtmlScene(
    fixture.projectId,
    { title: 'Kinetic', files: templateFiles('kinetic-title') as Record<string, string>, params: { title: 'In a frame', subtitle: HTML_SCENE_SUBTITLE } },
    fixture.home
  )
  return fixture
}

/** What the HTML scene says, to find it drawn. */
export const HTML_SCENE_SUBTITLE = 'Drawn by a web page'

function buildFixture(engine: SpeechEngineId): Fixture {
  const home = mkdtempSync(join(tmpdir(), 'talkie-e2e-'))
  updateSettings(
    { speech: engine === 'kokoro' ? { engine, voice: KOKORO_VOICE } : { engine }, narration: { autoDraft: false } },
    home
  )

  // The Kokoro weights are hundreds of megabytes and pinned by hash, so the run borrows the
  // copy already downloaded rather than fetching its own. Only the model folder is shared.
  if (engine === 'kokoro') symlinkSync(kokoroCacheDir(homedir()), kokoroCacheDir(home))

  // Playwright keeps its browsers under ~/Library/Caches, and export renders with its headless
  // shell when it finds one there. Without this the run would export through a full Chrome —
  // three times slower, and not what anyone with Playwright's browsers installed gets.
  const browsers = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  if (existsSync(browsers)) {
    mkdirSync(join(home, 'Library', 'Caches'), { recursive: true })
    symlinkSync(browsers, join(home, 'Library', 'Caches', 'ms-playwright'))
  }

  const script = engine === 'kokoro' ? [KOKORO_SILENT_LINE, SCRIPT[1]] : SCRIPT
  const project = createProject(PROJECT_NAME, home)
  for (const [index, title] of ['Welcome', 'How it works', 'The end'].entries()) {
    const item = addScene(project.id, 'scene', { title, bullets: ['One point', 'Another'] }, home)
    if (script[index]) addTranscriptSegment(project.id, { text: script[index], timelineItemId: item.id }, home)
  }
  return { home, projectId: project.id, dispose: () => rmSync(home, { recursive: true, force: true }) }
}

/** Whether this machine has the Kokoro model to borrow. */
export function kokoroAvailable(): boolean {
  return isKokoroDownloaded(homedir())
}
