import { homedir } from 'os'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { projectsRootDir } from './paths'
import { makeTimelinePortable } from './timelineFile'
import { writeJsonAtomic } from './atomicWrite'
import { migrateProjectMetadata } from './migrate'
import { CURRENT_SCHEMA_VERSION } from './schema'

/**
 * Store every project's media relative to its own folder, re-rooting what was left behind first.
 *
 * Timelines used to record media as full paths, so moving the projects folder — the rename from
 * Demo Studio to Talkie, the move into the Studio, a restored backup, a clone on another Mac — left
 * clips pointing at a folder that was no longer there. The files moved with the project; the paths
 * are now written relative to it (timelineFile.ts), which is also what lets a Studio be checked in.
 * A path whose media cannot be found is kept as it was: it is the only record of where it was.
 */
export function repairAssetPaths(baseDir: string = homedir()): void {
  const root = projectsRootDir(baseDir)
  if (!existsSync(root)) return

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    try {
      makeTimelinePortable(dir)
      stampCurrentVersion(dir)
    } catch (err) {
      console.error(`Could not make the media paths in ${dir} portable:`, err)
    }
  }
}

/**
 * Mark a project as the version that names media relatively, now that it does, so a Talkie from
 * before that refuses it plainly instead of opening clips it cannot find.
 */
function stampCurrentVersion(dir: string): void {
  const path = join(dir, 'project.json')
  if (!existsSync(path)) return
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as { schemaVersion?: unknown }
  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion >= CURRENT_SCHEMA_VERSION) return
  writeJsonAtomic(path, migrateProjectMetadata(raw as Record<string, unknown>))
}
