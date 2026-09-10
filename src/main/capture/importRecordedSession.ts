import { homedir } from 'os'
import { getVideoMetadata } from '@remotion/renderer'
import { addTimelineItem, readTimeline } from '../project/projectApi'
import { normalizeRecording } from './normalizeRecording'
import { FPS } from '../../remotion/constants'
import type { TimelineItem } from '../project/timeline/schema'

// Playwright writes its .webm progressively and does not always finalize a duration in the
// container header, so getVideoMetadata can legitimately report null. Fall back to a visible
// placeholder length rather than failing the import — the clip is still on the timeline and
// its duration can be corrected later.
const FALLBACK_DURATION_FRAMES = 90

export async function importRecordedSession(
  projectId: string,
  videoPath: string,
  baseDir: string = homedir(),
  options: { contentStartMs?: number } = {}
): Promise<TimelineItem> {
  // Convert before measuring, so the duration and the timeline item both describe the file
  // that will actually be played.
  const playablePath = await normalizeRecording(videoPath)

  let durationFrames = FALLBACK_DURATION_FRAMES
  try {
    const { durationInSeconds } = await getVideoMetadata(playablePath)
    if (durationInSeconds && durationInSeconds > 0) {
      durationFrames = Math.max(1, Math.round(durationInSeconds * FPS))
    }
  } catch (err) {
    console.error(`Could not read duration of recorded video ${playablePath}:`, err)
  }

  // Drop the blank page the recording opens with, but only while at least a second of clip
  // survives — a lead-in longer than that means the measurement is not to be trusted.
  const requestedTrim = Math.max(0, Math.round(((options.contentStartMs ?? 0) / 1000) * FPS))
  const trimBefore = requestedTrim > 0 && durationFrames - requestedTrim >= FPS ? requestedTrim : 0

  const timeline = readTimeline(projectId, baseDir)
  const start = timeline.length === 0 ? 0 : Math.max(...timeline.map((item) => item.start + item.duration))

  return addTimelineItem(
    projectId,
    {
      kind: 'video',
      start,
      duration: Math.max(1, durationFrames - trimBefore),
      data: trimBefore > 0 ? { src: playablePath, trimBefore } : { src: playablePath }
    },
    baseDir
  )
}
