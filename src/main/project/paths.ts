import { homedir } from 'os'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

export function projectsRootDir(baseDir: string = homedir()): string {
  return join(baseDir, 'DemoStudio', 'Projects')
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
