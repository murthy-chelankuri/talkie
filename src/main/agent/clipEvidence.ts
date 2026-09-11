import { homedir } from 'os'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { RenderInternals } from '@remotion/renderer'
import { readActionLog } from '../capture/actionLog'
import { cleanActionLog, type CleanAction } from './cleanActionLog'
import { readTimeline } from '../project/projectApi'
import { FPS } from '../../remotion/constants'
import type { TimelineItem } from '../project/timeline/schema'

/** Enough stills to show how a clip changes, few enough to stay cheap to send. */
export const MAX_FRAMES = 4

export interface ClipEvidence {
  kind: 'video' | 'image'
  durationSeconds: number
  /** Empty for an image, which has no recording behind it. */
  actions: CleanAction[]
  /** Stills sampled across the clip, or the image itself. */
  framePaths: string[]
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

  return gatherVideoEvidence(item, src, durationSeconds)
}

async function gatherVideoEvidence(
  item: TimelineItem,
  src: string | undefined,
  durationSeconds: number
): Promise<ClipEvidence> {
  const trimBefore = (item.data as { trimBefore?: number }).trimBefore ?? 0
  const startSeconds = trimBefore / FPS

  // The recorder writes the log beside the video it belongs to.
  const actions = src
    ? cleanActionLog(readActionLog(join(dirname(src), 'actions.jsonl')), {
        startSeconds,
        endSeconds: startSeconds + durationSeconds
      })
    : []

  if (!src || !existsSync(src)) {
    return { kind: 'video', durationSeconds, actions, framePaths: [] }
  }

  const frameDir = mkdtempSync(join(tmpdir(), 'talkie-frames-'))
  const framePaths = await sampleFrames(src, startSeconds, durationSeconds, frameDir)

  return {
    kind: 'video',
    durationSeconds,
    actions,
    framePaths,
    cleanup: () => rmSync(frameDir, { recursive: true, force: true })
  }
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
      await RenderInternals.callFf({
        bin: 'ffmpeg',
        // -ss before -i seeks without decoding everything up to that point.
        args: ['-ss', at.toFixed(3), '-i', videoPath, '-frames:v', '1', '-q:v', '4', '-y', outputPath],
        indent: false,
        logLevel: 'error',
        binariesDirectory: null,
        cancelSignal: undefined
      })
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
