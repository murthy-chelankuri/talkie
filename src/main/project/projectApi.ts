import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs'
import { basename, join } from 'path'
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
import { TimelineItemSchema, type TimelineItem } from './timeline/schema'
import { TranscriptSegmentSchema, type TranscriptSegment } from '../transcript/schema'
import { z } from 'zod'

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

export function readTimeline(id: string, baseDir: string = homedir()): TimelineItem[] {
  const dir = findProjectDir(id, baseDir)
  if (!dir || !existsSync(join(dir, 'timeline.json'))) {
    throw new Error(`No project found with id ${id}`)
  }

  const raw = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf-8'))
  try {
    return raw.map((item: unknown) => TimelineItemSchema.parse(item))
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues.map((issue) => issue.message).join('; '))
    }
    throw err
  }
}

export function readTimelineLenient(id: string, baseDir: string = homedir()): TimelineItem[] {
  const dir = findProjectDir(id, baseDir)
  if (!dir || !existsSync(join(dir, 'timeline.json'))) {
    throw new Error(`No project found with id ${id}`)
  }

  const raw = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf-8'))
  const items: TimelineItem[] = []
  for (const item of raw) {
    try {
      items.push(TimelineItemSchema.parse(item))
    } catch (err) {
      console.error(`Skipping invalid timeline item in project ${id}:`, err)
    }
  }
  return items
}

export function addTimelineItem(
  id: string,
  item: { kind: string; start: number; duration: number; data: unknown },
  baseDir: string = homedir()
): TimelineItem {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  let newItem: TimelineItem
  try {
    newItem = TimelineItemSchema.parse({ id: randomUUID(), ...item })
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues.map((issue) => issue.message).join('; '))
    }
    throw err
  }
  const timeline = readTimeline(id, baseDir)
  timeline.push(newItem)
  writeJsonAtomic(join(dir, 'timeline.json'), timeline)
  return newItem
}

const DEFAULT_IMAGE_DURATION_FRAMES = 90

export function importImage(id: string, sourcePath: string, baseDir: string = homedir()): TimelineItem {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const destPath = join(dir, 'sources', 'images', `${randomUUID()}-${basename(sourcePath)}`)
  copyFileSync(sourcePath, destPath)

  const timeline = readTimeline(id, baseDir)
  const start = timeline.length === 0 ? 0 : Math.max(...timeline.map((item) => item.start + item.duration))

  return addTimelineItem(id, { kind: 'image', start, duration: DEFAULT_IMAGE_DURATION_FRAMES, data: { src: destPath } }, baseDir)
}

export function readTranscript(id: string, baseDir: string = homedir()): TranscriptSegment[] {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const raw = JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf-8'))
  try {
    return raw.map((segment: unknown) => TranscriptSegmentSchema.parse(segment))
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues.map((issue) => issue.message).join('; '))
    }
    throw err
  }
}

export function readNarrationAudioPaths(id: string, baseDir: string = homedir()): Map<string, string> {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const transcript = readTranscript(id, baseDir)
  const paths = new Map<string, string>()
  for (const segment of transcript) {
    if (segment.status === 'narrated' && segment.audioFile) {
      paths.set(segment.timelineItemId, join(dir, 'audio', segment.audioFile))
    }
  }
  return paths
}

export function addTranscriptSegment(
  id: string,
  input: { text: string; timelineItemId: string },
  baseDir: string = homedir()
): TranscriptSegment {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  let newSegment: TranscriptSegment
  try {
    newSegment = TranscriptSegmentSchema.parse({
      id: randomUUID(),
      text: input.text,
      timelineItemId: input.timelineItemId,
      status: 'edited'
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues.map((issue) => issue.message).join('; '))
    }
    throw err
  }

  const transcript = readTranscript(id, baseDir)
  transcript.push(newSegment)
  writeJsonAtomic(join(dir, 'transcript.json'), transcript)
  return newSegment
}

export function updateTranscriptSegmentText(
  id: string,
  segmentId: string,
  text: string,
  baseDir: string = homedir()
): TranscriptSegment {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const transcript = readTranscript(id, baseDir)
  const index = transcript.findIndex((segment) => segment.id === segmentId)
  if (index === -1) {
    throw new Error(`No transcript segment found with id ${segmentId}`)
  }

  let updated: TranscriptSegment
  try {
    updated = TranscriptSegmentSchema.parse({ ...transcript[index], text, status: 'edited' })
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues.map((issue) => issue.message).join('; '))
    }
    throw err
  }
  transcript[index] = updated
  writeJsonAtomic(join(dir, 'transcript.json'), transcript)
  return updated
}

export function updateTranscriptSegmentAudio(
  id: string,
  segmentId: string,
  audioFile: string,
  baseDir: string = homedir()
): TranscriptSegment {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const transcript = readTranscript(id, baseDir)
  const index = transcript.findIndex((segment) => segment.id === segmentId)
  if (index === -1) {
    throw new Error(`No transcript segment found with id ${segmentId}`)
  }

  let updated: TranscriptSegment
  try {
    updated = TranscriptSegmentSchema.parse({ ...transcript[index], audioFile, status: 'narrated' })
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues.map((issue) => issue.message).join('; '))
    }
    throw err
  }
  transcript[index] = updated
  writeJsonAtomic(join(dir, 'transcript.json'), transcript)
  return updated
}

export function updateTimelineItemDuration(
  id: string,
  timelineItemId: string,
  duration: number,
  baseDir: string = homedir()
): TimelineItem {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const timeline = readTimeline(id, baseDir)
  const index = timeline.findIndex((item) => item.id === timelineItemId)
  if (index === -1) {
    throw new Error(`No timeline item found with id ${timelineItemId}`)
  }

  let updated: TimelineItem
  try {
    updated = TimelineItemSchema.parse({ ...timeline[index], duration })
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues.map((issue) => issue.message).join('; '))
    }
    throw err
  }
  timeline[index] = updated
  writeJsonAtomic(join(dir, 'timeline.json'), timeline)
  return updated
}

export function reorderTimelineItems(id: string, orderedIds: string[], baseDir: string = homedir()): TimelineItem[] {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const timeline = readTimeline(id, baseDir)
  const existingIds = new Set(timeline.map((item) => item.id))
  const isPermutation =
    orderedIds.length === timeline.length &&
    new Set(orderedIds).size === orderedIds.length &&
    orderedIds.every((itemId) => existingIds.has(itemId))
  if (!isPermutation) {
    throw new Error(`orderedIds must be a permutation of the existing timeline item ids for project ${id}`)
  }

  const byId = new Map(timeline.map((item) => [item.id, item]))
  let cursor = 0
  const reordered: TimelineItem[] = []
  for (const itemId of orderedIds) {
    const existing = byId.get(itemId) as TimelineItem
    let updated: TimelineItem
    try {
      updated = TimelineItemSchema.parse({ ...existing, start: cursor })
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new Error(err.issues.map((issue) => issue.message).join('; '))
      }
      throw err
    }
    reordered.push(updated)
    cursor += updated.duration
  }

  writeJsonAtomic(join(dir, 'timeline.json'), reordered)
  return reordered
}
