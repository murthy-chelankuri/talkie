import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'fs'
import { basename, join } from 'path'
import {
  CURRENT_SCHEMA_VERSION,
  ProjectMetadataSchema,
  type ProjectMetadata,
  type ProjectSummary,
  type ProjectOverview
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

// The browser shows projects without opening them, so a broken timeline or transcript must not
// hide the project — it is summarised as empty instead.
export function listProjectOverviews(baseDir: string = homedir()): ProjectOverview[] {
  return listProjects(baseDir).map((summary) => {
    let timeline: TimelineItem[] = []
    let transcript: TranscriptSegment[] = []
    try {
      timeline = readTimelineLenient(summary.id, baseDir)
    } catch (err) {
      console.error(`Could not read the timeline of project ${summary.id}:`, err)
    }
    try {
      transcript = readTranscript(summary.id, baseDir)
    } catch (err) {
      console.error(`Could not read the transcript of project ${summary.id}:`, err)
    }

    const narratedItemIds = new Set(
      transcript.filter((segment) => segment.status === 'narrated').map((segment) => segment.timelineItemId)
    )
    const poster = timeline[0]
    const posterData = poster?.data as { src?: string; trimBefore?: number } | undefined

    return {
      ...summary,
      clipCount: timeline.length,
      durationFrames: timeline.reduce((total, item) => total + item.duration, 0),
      narratedCount: timeline.filter((item) => narratedItemIds.has(item.id)).length,
      ...(posterData?.src
        ? {
            posterPath: posterData.src,
            posterKind: poster.kind,
            ...(posterData.trimBefore ? { posterTrimBefore: posterData.trimBefore } : {})
          }
        : {})
    }
  })
}

export function openProject(id: string, baseDir: string = homedir()): ProjectMetadata {
  const dir = findProjectDir(id, baseDir)
  if (!dir || !existsSync(join(dir, 'project.json'))) {
    throw new Error(`No project found with id ${id}`)
  }

  const raw = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf-8'))
  return migrateProjectMetadata(raw)
}

// Deleting a project takes its recordings, narration audio and renders with it, and no undo
// reaches across projects — the caller is expected to have confirmed first.
export function deleteProject(id: string, baseDir: string = homedir()): void {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }
  rmSync(dir, { recursive: true, force: true })
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

export const DEFAULT_IMAGE_DURATION_FRAMES = 90

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

export interface NarrationAudio {
  path: string
  // Re-narrating a segment rewrites the same filename, so the URL built from it would not
  // change and the renderer would keep playing the audio it had already cached. Carrying the
  // file's modification time lets the URL change whenever the audio does.
  version: number
}

export function readNarrationAudioPaths(
  id: string,
  baseDir: string = homedir()
): Map<string, NarrationAudio> {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const transcript = readTranscript(id, baseDir)
  const paths = new Map<string, NarrationAudio>()
  for (const segment of transcript) {
    if (segment.status !== 'narrated' || !segment.audioFile) continue

    const path = join(dir, 'audio', segment.audioFile)
    try {
      paths.set(segment.timelineItemId, { path, version: Math.round(statSync(path).mtimeMs) })
    } catch {
      // The transcript says this segment was narrated but the audio is gone; pointing the
      // composition at a missing file would only produce a failed request.
      console.error(`Narration audio missing for segment ${segment.id} in project ${id}`)
    }
  }
  return paths
}

// Each narration is written to its own file so an earlier take is never overwritten, which is
// what lets undo restore the voice along with the words. Takes no longer referenced are swept
// when a project is opened: history is empty at that point, so nothing can reach them.
export function sweepUnusedNarrationAudio(id: string, baseDir: string = homedir()): void {
  const dir = findProjectDir(id, baseDir)
  if (!dir) return

  let referenced: Set<string>
  try {
    referenced = new Set(
      readTranscript(id, baseDir)
        .map((segment) => segment.audioFile)
        .filter((file): file is string => Boolean(file))
    )
  } catch (err) {
    // Without a readable transcript there is no way to tell which takes are still in use.
    console.error(`Not sweeping narration audio for project ${id}:`, err)
    return
  }

  const audioDir = join(dir, 'audio')
  if (!existsSync(audioDir)) return

  for (const file of readdirSync(audioDir)) {
    if (referenced.has(file)) continue
    try {
      rmSync(join(audioDir, file))
    } catch (err) {
      console.error(`Could not remove unused narration audio ${file}:`, err)
    }
  }
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

/**
 * Write narration the agent produced, leaving it marked `draft`.
 *
 * The status is what separates words the agent guessed from words the user stands behind:
 * everything the user types or narrates becomes `edited` or `narrated`, so a later auto-draft
 * knows not to touch it.
 */
export function setDraftedNarration(
  id: string,
  timelineItemId: string,
  text: string,
  baseDir: string = homedir()
): TranscriptSegment {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const transcript = readTranscript(id, baseDir)
  const index = transcript.findIndex((segment) => segment.timelineItemId === timelineItemId)

  const segment = TranscriptSegmentSchema.parse(
    index === -1
      ? { id: randomUUID(), text, timelineItemId, status: 'draft' }
      : { ...transcript[index], text, status: 'draft' }
  )

  if (index === -1) transcript.push(segment)
  else transcript[index] = segment

  writeJsonAtomic(join(dir, 'transcript.json'), transcript)
  return segment
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

export function deleteTranscriptSegment(
  id: string,
  segmentId: string,
  baseDir: string = homedir()
): TranscriptSegment[] {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const transcript = readTranscript(id, baseDir)
  const remaining = transcript.filter((segment) => segment.id !== segmentId)
  if (remaining.length === transcript.length) {
    throw new Error(`No transcript segment found with id ${segmentId}`)
  }

  writeJsonAtomic(join(dir, 'transcript.json'), remaining)
  return remaining
}

export function updateTranscriptSegmentAudio(
  id: string,
  segmentId: string,
  audioFile: string,
  voice: string,
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
    updated = TranscriptSegmentSchema.parse({ ...transcript[index], audioFile, voice, status: 'narrated' })
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

// Timeline items play back-to-back with no gaps, so every `start` is fully determined by the
// durations before it. Any write that changes a duration or an order has to re-derive them all.
function withSequentialStarts(items: TimelineItem[]): TimelineItem[] {
  let cursor = 0
  return items.map((item) => {
    let updated: TimelineItem
    try {
      updated = TimelineItemSchema.parse({ ...item, start: cursor })
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new Error(err.issues.map((issue) => issue.message).join('; '))
      }
      throw err
    }
    cursor += updated.duration
    return updated
  })
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
  const resequenced = withSequentialStarts(timeline)
  writeJsonAtomic(join(dir, 'timeline.json'), resequenced)
  return resequenced[index]
}

export function deleteTimelineItem(
  id: string,
  timelineItemId: string,
  baseDir: string = homedir()
): TimelineItem[] {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const timeline = readTimeline(id, baseDir)
  const remaining = timeline.filter((item) => item.id !== timelineItemId)
  if (remaining.length === timeline.length) {
    throw new Error(`No timeline item found with id ${timelineItemId}`)
  }

  const resequenced = withSequentialStarts(remaining)
  writeJsonAtomic(join(dir, 'timeline.json'), resequenced)

  // Narration belongs to a clip, so it goes with it rather than lingering as a segment
  // pointing at something no longer on the timeline.
  const transcript = readTranscript(id, baseDir)
  const keptSegments = transcript.filter((segment) => segment.timelineItemId !== timelineItemId)
  if (keptSegments.length !== transcript.length) {
    writeJsonAtomic(join(dir, 'transcript.json'), keptSegments)
  }

  return resequenced
}

export function splitTimelineItem(
  id: string,
  timelineItemId: string,
  atFrame: number,
  baseDir: string = homedir()
): TimelineItem[] {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const timeline = readTimeline(id, baseDir)
  const index = timeline.findIndex((item) => item.id === timelineItemId)
  if (index === -1) {
    throw new Error(`No timeline item found with id ${timelineItemId}`)
  }

  const item = timeline[index]
  const offset = atFrame - item.start
  if (offset <= 0 || offset >= item.duration) {
    throw new Error(`Cannot split timeline item ${timelineItemId} at frame ${atFrame}`)
  }

  // The second half has to start where the first half stopped, or it would replay footage the
  // first half already showed. Kinds without a trim (an image) are the same picture throughout.
  const data = item.data as { trimBefore?: number } | undefined
  const secondData =
    data && typeof data.trimBefore === 'number'
      ? { ...data, trimBefore: data.trimBefore + offset }
      : item.kind === 'video'
        ? { ...(data as object), trimBefore: offset }
        : item.data

  let halves: TimelineItem[]
  try {
    halves = [
      TimelineItemSchema.parse({ ...item, duration: offset }),
      TimelineItemSchema.parse({
        ...item,
        id: randomUUID(),
        start: atFrame,
        duration: item.duration - offset,
        data: secondData
      })
    ]
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues.map((issue) => issue.message).join('; '))
    }
    throw err
  }

  const split = [...timeline.slice(0, index), ...halves, ...timeline.slice(index + 1)]
  const resequenced = withSequentialStarts(split)
  writeJsonAtomic(join(dir, 'timeline.json'), resequenced)
  return [resequenced[index], resequenced[index + 1]]
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
  const reordered = withSequentialStarts(orderedIds.map((itemId) => byId.get(itemId) as TimelineItem))

  writeJsonAtomic(join(dir, 'timeline.json'), reordered)
  return reordered
}
