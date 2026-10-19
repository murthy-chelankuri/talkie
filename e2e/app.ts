import { readFileSync, readdirSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { PROJECT_NAME, type Fixture } from './fixture'
import type { TranscriptSegment } from '../src/main/transcript/schema'
import { projectsRootDir } from '../src/main/project/paths'

export type Talkie = {
  app: ElectronApplication
  win: Page
  /** Every error the window logged or threw. A run ends by asserting this is empty. */
  errors: string[]
  close: () => Promise<void>
}

/**
 * Start the built app — `out/`, not the sources — against a fixture's home folder.
 *
 * It is the build that ships, and the build is where the bugs this exists for lived: a refused
 * permission, a policy that blocked a file, a worker that only fails once bundled.
 */
export async function launchTalkie(
  fixture: Fixture,
  options: { switches?: string[]; appDir?: string } = {}
): Promise<Talkie> {
  // Another checkout runs with its own Electron, so it is that copy's install that is tried.
  const appDir = options.appDir ?? join(__dirname, '..')
  const executablePath = options.appDir ? (createRequire(join(appDir, 'package.json'))('electron') as string) : undefined
  const app = await _electron.launch({
    ...(executablePath ? { executablePath } : {}),
    // A profile inside the fixture too: on macOS Electron finds its user-data folder from the
    // system, not HOME, so a run otherwise shares the person's own window state and storage.
    // Chromium switches go first, where Chromium reads them — a proxy, for one.
    args: [...(options.switches ?? []), '.', `--user-data-dir=${join(fixture.home, 'profile')}`],
    cwd: appDir,
    env: { ...process.env, HOME: fixture.home, TALKIE_HEADLESS: '1' }
  })
  // Finishing an export reveals it in Finder, and links open in the browser. Neither is what a
  // test run should do to whoever is sitting at the machine.
  await app.evaluate(({ shell }) => {
    shell.openPath = async () => ''
    shell.showItemInFolder = () => undefined
    shell.openExternal = async () => undefined
  })

  const win = await app.firstWindow()
  const errors: string[] = []
  win.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  win.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`))
  win.on('crash', () => errors.push('The window crashed'))

  return {
    app,
    win,
    errors,
    close: async () => {
      await app.close().catch(() => undefined)
    }
  }
}

export async function openProject(win: Page): Promise<void> {
  await win.getByRole('button', { name: `Open ${PROJECT_NAME}` }).click()
  await win.getByRole('tablist', { name: 'Ways to work on this project' }).waitFor()
}

function projectDir(fixture: Fixture): string {
  const root = projectsRootDir(fixture.home)
  const name = readdirSync(root).find((entry) => entry.startsWith(fixture.projectId))
  if (!name) throw new Error('The fixture project has gone')
  return join(root, name)
}

/** The narration as it is on disk — what was saved, not what the window shows. */
export function transcriptOnDisk(fixture: Fixture): TranscriptSegment[] {
  return JSON.parse(readFileSync(join(projectDir(fixture), 'transcript.json'), 'utf8'))
}

export function takePath(fixture: Fixture, segment: TranscriptSegment): string {
  if (!segment.audioFile) throw new Error(`“${segment.text}” has no take`)
  return join(projectDir(fixture), 'audio', segment.audioFile)
}

export function exportsIn(fixture: Fixture): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.mp4')) found.push(path)
    }
  }
  walk(projectDir(fixture))
  return found
}
