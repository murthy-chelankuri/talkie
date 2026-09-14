import { homedir } from 'os'
import { dirname, join } from 'path'
import { getVideoMetadata } from '@remotion/renderer'
import { addTimelineItem, readTimeline } from '../project/projectApi'
import { stitchRecording, type RecordedClip } from './stitchRecording'
import { rebaseActionLog, VIDEO_TIME_LOG } from './rebaseActionLog'
import { FPS } from '../../remotion/constants'
import type { TimelineItem } from '../project/timeline/schema'

// Playwright writes its .webm progressively and does not always finalize a duration in the
// container header, so getVideoMetadata can legitimately report null. Fall back to a visible
// placeholder length rather than failing the import — the clip is still on the timeline and
// its duration can be corrected later.
const FALLBACK_DURATION_FRAMES = 90

export interface RecordedSession {
  clips: RecordedClip[]
  /** How much of the start is the blank page before the site loaded. */
  contentStartMs?: number
}

export async function importRecordedSession(
  projectId: string,
  recording: RecordedSession,
  baseDir: string = homedir()
): Promise<TimelineItem> {
  if (recording.clips.length === 0) {
    throw new Error('The recording produced no video')
  }

  const sessionDir = dirname(recording.clips[0].videoPath)

  // Stitch before measuring, so the duration and the timeline item both describe the file that
  // will actually be played.
  const playablePath = await stitchRecording(recording.clips, join(sessionDir, 'video.mp4'))

  // What happened, timed against the file that was just written rather than against the
  // session — see rebaseActionLog for why those stopped being the same thing.
  rebaseActionLog(join(sessionDir, 'actions.jsonl'), join(sessionDir, VIDEO_TIME_LOG), recording.clips)

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
  const requestedTrim = Math.max(0, Math.round(((recording.contentStartMs ?? 0) / 1000) * FPS))
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
