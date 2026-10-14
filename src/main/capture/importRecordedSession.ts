import { homedir } from 'os'
import { dirname, join } from 'path'
import { addTimelineItem, readTimeline } from '../project/projectApi'
import { stitchRecording, type RecordedClip } from './stitchRecording'
import { rebaseActionLog, VIDEO_TIME_LOG } from './rebaseActionLog'
import { readActionLog } from './actionLog'
import { planScenes } from './sceneBoundaries'
import { cleanActionLog } from '../agent/cleanActionLog'
import { findTopicBreaks } from '../agent/topicBreaks'
import { probeMedia } from '../media'
import { logFailure } from '../diagnostics/log'
import { FPS } from '../../composition/constants'
import type { TimelineItem } from '../project/timeline/schema'

// Playwright writes its .webm progressively and does not always finalize a duration in the
// container header, so probing can legitimately report null. Fall back to a visible
// placeholder length rather than failing the import — the clip is still on the timeline and
// its duration can be corrected later.
//
// Three seconds, and it decides the length of the whole import: every scene is cut against this
// number. That made it the most expensive fallback in the app when measuring failed for a reason
// that was not the container, such as the probe failing to run.
const FALLBACK_DURATION_FRAMES = 90

/**
 * How much of the front of the recording is the blank page before the site painted.
 *
 * Dropped only while at least a second of clip survives it: a lead-in measured as longer than
 * the recording is a measurement that has gone wrong, and trimming on it would leave a clip of
 * nothing. Pure, because it is the part worth being sure of — how long a real capture comes out
 * varies with the machine, and a test that pinned it to a frame count was a test that failed
 * when the machine was busy.
 */
export function leadInToDrop(durationFrames: number, contentStartMs: number | undefined): number {
  const requested = Math.max(0, Math.round(((contentStartMs ?? 0) / 1000) * FPS))
  return requested > 0 && durationFrames - requested >= FPS ? requested : 0
}

export interface RecordedSession {
  clips: RecordedClip[]
  /** How much of the start is the blank page before the site loaded. */
  contentStartMs?: number
}

/**
 * Bring a finished recording onto the timeline, as the scenes it is made of.
 *
 * A session used to arrive as a single clip however long it ran, and a single clip takes a
 * single take of narration — which could only be in step with the picture at the moment it
 * started, because every estimate that came out long pushed everything after it later with
 * nothing to stop the drift. The recording is now cut at the moments something changed, and each
 * scene is drafted, read and fitted against its own stretch of footage. See sceneBoundaries.ts.
 */
export async function importRecordedSession(
  projectId: string,
  recording: RecordedSession,
  baseDir: string = homedir()
): Promise<TimelineItem[]> {
  if (recording.clips.length === 0) {
    throw new Error('The recording produced no video')
  }

  const sessionDir = dirname(recording.clips[0].videoPath)

  // Stitch before measuring, so the duration and the timeline item both describe the file that
  // will actually be played.
  const playablePath = await stitchRecording(recording.clips, join(sessionDir, 'video.mp4'))

  // What happened, timed against the file that was just written rather than against the
  // session — see rebaseActionLog for why those stopped being the same thing.
  const videoLogPath = join(sessionDir, VIDEO_TIME_LOG)
  rebaseActionLog(join(sessionDir, 'actions.jsonl'), videoLogPath, recording.clips)

  let durationFrames = FALLBACK_DURATION_FRAMES
  try {
    // src/main/media finds its binaries from its own folder, packaged or not. When measuring
    // threw for want of them, the fallback above stood in for the real length and a recording of
    // any duration arrived on the timeline as three seconds of its opening. For an app behind a
    // login that is the login and nothing after it.
    const { durationSeconds } = await probeMedia(playablePath)
    if (durationSeconds && durationSeconds > 0) {
      durationFrames = Math.max(1, Math.round(durationSeconds * FPS))
    }
  } catch (err) {
    logFailure(`Could not read duration of recorded video ${playablePath}`, err)
  }

  const trimBefore = leadInToDrop(durationFrames, recording.contentStartMs)

  const playedMs = ((durationFrames - trimBefore) / FPS) * 1000
  // On the same clock as the trim: both are measured from the start of the stitched file.
  const entries = readActionLog(videoLogPath).map((entry) => ({
    ...entry,
    t: entry.t - (trimBefore / FPS) * 1000
  }))

  // Where the demo changes subject, so a scene is not half one thing and half the next. Asked
  // of whichever model is already set up, and simply absent when there is none — see
  // topicBreaks.ts, which never lets this fail the import.
  const topics = await findTopicBreaks(
    cleanActionLog(entries, { startSeconds: 0, endSeconds: playedMs / 1000 }),
    playedMs / 1000,
    baseDir
  )

  const scenes = planScenes(
    playedMs,
    entries,
    // Where the person moved to another tab, which is the clearest break a session has.
    pageChangesMs(recording.clips, trimBefore),
    topics
  )

  const timeline = readTimeline(projectId, baseDir)
  let start = timeline.length === 0 ? 0 : Math.max(...timeline.map((item) => item.start + item.duration))

  const added: TimelineItem[] = []
  for (const scene of scenes) {
    const from = trimBefore + Math.round((scene.fromMs / 1000) * FPS)
    // Each scene ends where the next begins, so the footage runs through the cut unbroken and
    // no frame is played twice.
    const to = Math.min(durationFrames, Math.max(from + 1, from + Math.round((scene.durationMs / 1000) * FPS)))

    const item = addTimelineItem(
      projectId,
      {
        kind: 'video',
        start,
        duration: to - from,
        data: {
          src: playablePath,
          ...(from > 0 ? { trimBefore: from } : {}),
          ...(to < durationFrames ? { trimAfter: to } : {})
        }
      },
      baseDir
    )
    added.push(item)
    start += item.duration
  }

  return added
}

/** Where each page after the first takes over the stitched video, in milliseconds. */
function pageChangesMs(clips: RecordedClip[], trimBeforeFrames: number): number[] {
  const trimMs = (trimBeforeFrames / FPS) * 1000
  const changes: number[] = []
  let at = 0
  for (const clip of clips.slice(0, -1)) {
    at += clip.durationMs
    changes.push(at - trimMs)
  }
  return changes.filter((ms) => ms > 0)
}
