import { homedir } from 'os'
import { getVideoMetadata } from '@remotion/renderer'
import { addTimelineItem, readTimeline } from '../project/projectApi'
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
  baseDir: string = homedir()
): Promise<TimelineItem> {
  let durationFrames = FALLBACK_DURATION_FRAMES
  try {
    const { durationInSeconds } = await getVideoMetadata(videoPath)
    if (durationInSeconds && durationInSeconds > 0) {
      durationFrames = Math.max(1, Math.round(durationInSeconds * FPS))
    }
  } catch (err) {
    console.error(`Could not read duration of recorded video ${videoPath}:`, err)
  }

  const timeline = readTimeline(projectId, baseDir)
  const start = timeline.length === 0 ? 0 : Math.max(...timeline.map((item) => item.start + item.duration))

  return addTimelineItem(
    projectId,
    { kind: 'video', start, duration: durationFrames, data: { src: videoPath } },
    baseDir
  )
}
