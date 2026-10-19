import { homedir } from 'os'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ROOT_NAME } from '../project/migrateStorageRoot'

/**
 * The Studio: everything a video is made of, in one folder that can be a git repository.
 *
 *   ~/Talkie/Studio/Projects   the projects, their media named relative to their own folder
 *   ~/Talkie/Studio/Themes     the theme library every project in it draws from
 *   ~/Talkie/Studio/talkie.json  the settings that shape a video — voice, pace, captions, highlight
 *
 * Checked in and cloned on another Mac, it carries on where it was left. What belongs to one Mac
 * stays beside it in ~/Talkie and never enters it: settings.json (API keys, the agent token, which
 * model to ask), the Kokoro model, logs, window positions.
 */
export const STUDIO_NAME = 'Studio'

export function studioDir(baseDir: string = homedir()): string {
  return join(baseDir, ROOT_NAME, STUDIO_NAME)
}

/** The settings that travel with the Studio. See settingsStore.ts for which those are. */
export function sharedSettingsPath(baseDir: string = homedir()): string {
  return join(studioDir(baseDir), 'talkie.json')
}

/**
 * What a Studio never checks in. Exports and agent run records are made from the project and
 * made again; drafts are themes not yet saved; the temporary files are writes caught halfway.
 */
export const STUDIO_GITIGNORE = `# Talkie Studio — written by Talkie. Add your own lines below.
.DS_Store
.*.tmp
Themes/.drafts/
Projects/*/renders/
Projects/*/agents/
# The examples Talkie ships, which every Mac installs for itself.
`

function gitignorePath(baseDir: string): string {
  return join(studioDir(baseDir), '.gitignore')
}

/** The Studio folder and its .gitignore, made if they are not there. Never rewrites a .gitignore. */
export function ensureStudio(baseDir: string = homedir()): void {
  mkdirSync(studioDir(baseDir), { recursive: true })
  if (!existsSync(gitignorePath(baseDir))) writeFileSync(gitignorePath(baseDir), STUDIO_GITIGNORE)
}

/**
 * Keep a path inside the Studio out of git — an installed example, which every Mac installs for
 * itself and which carries minutes of video nobody made.
 */
export function keepOutOfGit(relativePath: string, baseDir: string = homedir()): void {
  ensureStudio(baseDir)
  const line = `${relativePath.replace(/\\/g, '/')}/`
  const current = readFileSync(gitignorePath(baseDir), 'utf-8')
  if (current.split('\n').includes(line)) return
  appendFileSync(gitignorePath(baseDir), `${current.endsWith('\n') ? '' : '\n'}${line}\n`)
}

/**
 * Move projects and themes from ~/Talkie, where they lived before the Studio, into it.
 *
 * Timid in the way the Demo Studio move was: each folder moves only when the Studio has none of
 * its own, so two sets can never be merged, and a failed move leaves the old folder where the
 * paths still find it.
 */
export function moveIntoStudio(baseDir: string = homedir()): void {
  for (const name of ['Projects', 'Themes']) {
    const before = join(baseDir, ROOT_NAME, name)
    const after = join(studioDir(baseDir), name)
    if (!existsSync(before) || existsSync(after)) continue
    try {
      mkdirSync(studioDir(baseDir), { recursive: true })
      renameSync(before, after)
    } catch (err) {
      console.error(`Could not move ${before} into the Studio:`, err)
    }
  }
  ensureStudio(baseDir)
}
