import { homedir } from 'os'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { readActionLog } from '../capture/actionLog'
import { VIDEO_TIME_LOG } from '../capture/rebaseActionLog'
import { runFfmpeg } from '../media'
import { cleanActionLog, type CleanAction } from './cleanActionLog'
import { readTimeline } from '../project/projectApi'
import { FPS } from '../../composition/constants'
import type { TimelineItem } from '../project/timeline/schema'

/** Enough stills to show how a clip changes, few enough to stay cheap to send. */
export const MAX_FRAMES = 4

export interface ClipEvidence {
  kind: 'video' | 'image' | 'scene' | 'diagram'
  durationSeconds: number
  /** Empty for anything without a recording behind it. */
  actions: CleanAction[]
  /** Stills sampled across the clip, or the image itself. Empty for a scene. */
  framePaths: string[]
  /**
   * What a scene written in the app actually says — the slide's words, or the diagram's source.
   * Worth more than a picture of it: the words are exact, and mermaid source describes a flow
   * far better than a rendering of it does.
   */
  sceneText?: string
  /** Present only while sampled frames need cleaning up afterwards. */
  cleanup?: () => void
}

/**
 * Assemble what a provider needs to describe one clip: what happened during it, and what it
 * looked like. Frames are sampled into a temp directory the caller disposes of through
 * `cleanup`, so nothing is left behind in the project.
 */
export async function gatherClipEvidence(
  projectId: string,
  timelineItemId: string,
  baseDir: string = homedir()
): Promise<ClipEvidence> {
  const item = readTimeline(projectId, baseDir).find((candidate) => candidate.id === timelineItemId)
  if (!item) {
    throw new Error(`No timeline item found with id ${timelineItemId}`)
  }

  const durationSeconds = item.duration / FPS
  const src = (item.data as { src?: string }).src

  if (item.kind === 'image') {
    return {
      kind: 'image',
      durationSeconds,
      actions: [],
      framePaths: src && existsSync(src) ? [src] : []
    }
  }

  // A scene is read, not watched. Its own content is the evidence, and sampling frames from it
  // is not merely wasteful — a diagram's source is an SVG, which ffmpeg cannot decode at all.
  if (item.kind === 'scene' || item.kind === 'diagram') {
    return {
      kind: item.kind,
      durationSeconds,
      actions: [],
      framePaths: [],
      sceneText: describeScene(item)
    }
  }

  // A page is read the way it was described when it was made, and by the words its poster shows.
  if (item.kind === 'html') {
    const { title, prompt, posterText } = item.data as { title?: string; prompt?: string; posterText?: string }
    return {
      kind: 'scene',
      durationSeconds,
      actions: [],
      framePaths: [],
      sceneText: [
        title ? `Title: ${title}` : null,
        prompt ? `Made to show: ${prompt}` : null,
        posterText ? `Words on screen: ${posterText}` : null
      ]
        .filter(Boolean)
        .join('\n')
    }
  }

  return gatherVideoEvidence(item, src, durationSeconds)
}

/** A scene written out as the model should read it: what is on screen, in the order it appears. */
function describeScene(item: TimelineItem): string {
  if (item.kind === 'diagram') {
    const { title, source } = item.data as { title?: string; source?: string }
    return [title ? `Title on screen: ${title}` : null, 'The diagram, as mermaid source:', source ?? '']
      .filter(Boolean)
      .join('\n')
  }

  const { title, bullets } = item.data as { title?: string; bullets?: string[] }
  return [
    `Heading on screen: ${title ?? ''}`,
    ...(bullets ?? []).filter((line) => line.trim()).map((line) => `Line on screen: ${line}`)
  ].join('\n')
}

/**
 * What this clip has footage behind, in seconds from the start of the recording.
 *
 * Scenes cut from one session all point at the same file, so a clip owns a stretch of it rather
 * than the whole thing — and a clip lengthened to hold its narration still owns only that
 * stretch. Reading past it would describe, and talk over, the scene that comes next.
 */
export function footageWindow(item: TimelineItem): { startSeconds: number; endSeconds: number } {
  const { trimBefore, trimAfter } = item.data as { trimBefore?: number; trimAfter?: number }
  const startSeconds = (trimBefore ?? 0) / FPS
  const durationSeconds = item.duration / FPS
  const seconds = trimAfter ? Math.min(durationSeconds, trimAfter / FPS - startSeconds) : durationSeconds

  return { startSeconds, endSeconds: startSeconds + seconds }
}

/**
 * What happened during one clip, timed from the clip's own start.
 *
 * The log timed against the stitched video sits beside it. Recordings made before a session
 * could span several tabs have only the session log, and for those the two are the same thing.
 */
export function clipActions(item: TimelineItem): CleanAction[] {
  const src = (item.data as { src?: string }).src
  if (!src) return []

  try {
    return cleanActionLog(readActionLog(logBeside(src)), footageWindow(item))
  } catch (err) {
    // A clip whose log cannot be read is still worth describing from its pictures alone.
    console.error(`Could not read what happened during ${src}:`, err)
    return []
  }
}

async function gatherVideoEvidence(
  item: TimelineItem,
  src: string | undefined,
  durationSeconds: number
): Promise<ClipEvidence> {
  const { startSeconds, endSeconds } = footageWindow(item)
  const footageSeconds = endSeconds - startSeconds
  const actions = clipActions(item)

  if (!src || !existsSync(src)) {
    return { kind: 'video', durationSeconds, actions, framePaths: [] }
  }

  const frameDir = mkdtempSync(join(tmpdir(), 'talkie-frames-'))
  const framePaths = await sampleFrames(src, startSeconds, footageSeconds, frameDir)

  return {
    kind: 'video',
    durationSeconds,
    actions,
    framePaths,
    cleanup: () => rmSync(frameDir, { recursive: true, force: true })
  }
}

function logBeside(src: string): string {
  const onVideoClock = join(dirname(src), VIDEO_TIME_LOG)
  return existsSync(onVideoClock) ? onVideoClock : join(dirname(src), 'actions.jsonl')
}

/**
 * Pull evenly spaced stills out of the clip. Sampling inside the clip rather than at its very
 * edges avoids the transition frames at either end, which show nothing useful.
 */
async function sampleFrames(
  videoPath: string,
  startSeconds: number,
  durationSeconds: number,
  outputDir: string
): Promise<string[]> {
  const count = Math.max(1, Math.min(MAX_FRAMES, Math.ceil(durationSeconds / 5)))
  const step = durationSeconds / (count + 1)

  const paths: string[] = []
  for (let index = 0; index < count; index += 1) {
    const at = startSeconds + step * (index + 1)
    const outputPath = join(outputDir, `frame-${index}.jpg`)

    try {
      // -ss before -i seeks without decoding everything up to that point.
      await runFfmpeg(['-ss', at.toFixed(3), '-i', videoPath, '-frames:v', '1', '-q:v', '4', '-y', outputPath])
      if (existsSync(outputPath)) paths.push(outputPath)
    } catch (err) {
      // A clip we cannot sample is still worth narrating from its action log alone.
      console.error(`Could not sample a frame at ${at.toFixed(1)}s of ${videoPath}:`, err)
    }
  }

  return paths
}

/** Frames left in a temp directory by a cancelled draft, for tests and housekeeping. */
export function countSampledFrames(frameDir: string): number {
  return existsSync(frameDir) ? readdirSync(frameDir).length : 0
}
