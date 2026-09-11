import { homedir } from 'os'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { LEGACY_ROOT_NAME, ROOT_NAME } from './migrateStorageRoot'

export function projectsRootDir(baseDir: string = homedir()): string {
  const current = join(baseDir, ROOT_NAME, 'Projects')
  if (existsSync(current)) return current

  // The rename from Demo Studio to Talkie normally happens at startup. Should that move ever
  // fail, the projects are still on disk under the old name — keep reading them there rather
  // than showing an empty launcher.
  const legacy = join(baseDir, LEGACY_ROOT_NAME, 'Projects')
  return existsSync(legacy) ? legacy : current
}

export function projectDirName(id: string, slug: string): string {
  return `${id}-${slug}`
}

export function findProjectDir(id: string, baseDir: string = homedir()): string | undefined {
  const root = projectsRootDir(baseDir)
  if (!existsSync(root)) return undefined

  const match = readdirSync(root, { withFileTypes: true }).find(
    (entry) => entry.isDirectory() && entry.name.startsWith(`${id}-`)
  )

  return match ? join(root, match.name) : undefined
}

export const PROJECT_SUBDIRS = [
  'sources/images',
  'sources/slides',
  'audio',
  'renders',
  'agents/runs'
] as const
