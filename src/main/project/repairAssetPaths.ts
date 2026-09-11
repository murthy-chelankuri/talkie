import { homedir } from 'os'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { projectsRootDir } from './paths'
import { writeJsonAtomic } from './atomicWrite'

/**
 * Point a timeline's media back at the files after the project folder has moved.
 *
 * Timeline items record where their media lives as an absolute path, so moving the projects
 * folder — the rename from Demo Studio to Talkie, a restored backup, a different machine —
 * leaves every clip pointing at a directory that is no longer there. The files themselves
 * moved with the project, so the fix is to re-root each path onto the project's current
 * directory.
 *
 * Only paths that are actually broken are touched, and only when the media is really at the
 * re-rooted location: a path we cannot resolve is left as it is, since it is the only record
 * of where that media was meant to come from.
 */
export function repairAssetPaths(baseDir: string = homedir()): void {
  const root = projectsRootDir(baseDir)
  if (!existsSync(root)) return

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    repairProject(join(root, entry.name), entry.name)
  }
}

function repairProject(projectDir: string, dirName: string): void {
  const timelinePath = join(projectDir, 'timeline.json')
  if (!existsSync(timelinePath)) return

  let items: unknown
  try {
    items = JSON.parse(readFileSync(timelinePath, 'utf-8'))
  } catch (err) {
    console.error(`Could not read ${timelinePath} to repair its media paths:`, err)
    return
  }
  if (!Array.isArray(items)) return

  let changed = false
  const repaired = items.map((item) => {
    const src = (item as { data?: { src?: unknown } })?.data?.src
    if (typeof src !== 'string') return item

    const next = rerootedPath(src, projectDir, dirName)
    if (!next) return item

    changed = true
    return { ...(item as object), data: { ...(item as { data: object }).data, src: next } }
  })

  if (changed) writeJsonAtomic(timelinePath, repaired)
}

function rerootedPath(src: string, projectDir: string, dirName: string): string | null {
  if (existsSync(src)) return null

  // Everything after the project's own folder name is the part that travelled with it.
  const marker = `/${dirName}/`
  const at = src.indexOf(marker)
  if (at === -1) return null

  const candidate = join(projectDir, src.slice(at + marker.length))
  return candidate !== src && existsSync(candidate) ? candidate : null
}
