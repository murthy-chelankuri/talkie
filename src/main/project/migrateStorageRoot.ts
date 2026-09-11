import { homedir } from 'os'
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'fs'
import { join } from 'path'

/** Where projects lived when the app was called Demo Studio. */
export const LEGACY_ROOT_NAME = 'DemoStudio'
export const ROOT_NAME = 'Talkie'

/**
 * Move a previous installation's projects into the folder the app now uses.
 *
 * This runs before anything reads a project, and it is deliberately timid: it moves the
 * projects folder only when the new home is empty, so a half-migrated state can never merge
 * two sets of projects together. Failure is not fatal — `projectsRootDir` falls back to the
 * old location, so the projects stay reachable either way.
 */
export function migrateStorageRoot(baseDir: string = homedir()): void {
  const legacyProjects = join(baseDir, LEGACY_ROOT_NAME, 'Projects')
  const nextProjects = join(baseDir, ROOT_NAME, 'Projects')

  if (!existsSync(legacyProjects) || existsSync(nextProjects)) return

  try {
    mkdirSync(join(baseDir, ROOT_NAME), { recursive: true })
    renameSync(legacyProjects, nextProjects)
  } catch (err) {
    console.error(`Could not move projects from ${legacyProjects} to ${nextProjects}:`, err)
    return
  }

  // Tidy up the old container, but only if it held nothing but the projects.
  try {
    const legacyRoot = join(baseDir, LEGACY_ROOT_NAME)
    if (readdirSync(legacyRoot).length === 0) rmdirSync(legacyRoot)
  } catch (err) {
    console.error(`Left the empty ${LEGACY_ROOT_NAME} folder in place:`, err)
  }
}
