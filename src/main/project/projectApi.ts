import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  CURRENT_SCHEMA_VERSION,
  ProjectMetadataSchema,
  type ProjectMetadata,
  type ProjectSummary
} from './schema'
import { projectsRootDir, projectDirName, PROJECT_SUBDIRS, findProjectDir } from './paths'
import { slugify } from './slug'
import { writeJsonAtomic } from './atomicWrite'
import { migrateProjectMetadata } from './migrate'

export function createProject(name: string, baseDir: string = homedir()): ProjectMetadata {
  const id = randomUUID()
  const slug = slugify(name)
  const dir = join(projectsRootDir(baseDir), projectDirName(id, slug))

  mkdirSync(dir, { recursive: true })
  for (const subdir of PROJECT_SUBDIRS) {
    mkdirSync(join(dir, subdir), { recursive: true })
  }

  const metadata: ProjectMetadata = ProjectMetadataSchema.parse({
    id,
    name,
    createdAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION
  })

  writeJsonAtomic(join(dir, 'project.json'), metadata)
  writeJsonAtomic(join(dir, 'timeline.json'), [])
  writeJsonAtomic(join(dir, 'transcript.json'), [])

  return metadata
}

export function listProjects(baseDir: string = homedir()): ProjectSummary[] {
  const root = projectsRootDir(baseDir)
  if (!existsSync(root)) return []

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry): ProjectSummary | undefined => {
      const metadataPath = join(root, entry.name, 'project.json')
      if (!existsSync(metadataPath)) return undefined

      try {
        const raw = JSON.parse(readFileSync(metadataPath, 'utf-8'))
        const metadata = migrateProjectMetadata(raw)
        return { id: metadata.id, name: metadata.name, createdAt: metadata.createdAt }
      } catch (err) {
        console.error(`Skipping unreadable project at ${entry.name}:`, err)
        return undefined
      }
    })
    .filter((summary): summary is ProjectSummary => summary !== undefined)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function openProject(id: string, baseDir: string = homedir()): ProjectMetadata {
  const dir = findProjectDir(id, baseDir)
  if (!dir || !existsSync(join(dir, 'project.json'))) {
    throw new Error(`No project found with id ${id}`)
  }

  const raw = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf-8'))
  return migrateProjectMetadata(raw)
}
