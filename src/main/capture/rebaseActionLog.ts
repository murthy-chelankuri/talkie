import { readActionLog, writeActionLog, type ActionLogEntry } from './actionLog'
import type { RecordedClip } from './stitchRecording'

/** What the finished video is called, and the log that is written on the same clock as it. */
export const VIDEO_TIME_LOG = 'actions.video.jsonl'

/**
 * Put the action log back onto the clock the finished video runs on.
 *
 * The recorder writes times from the start of the session. That was the same thing as time into
 * the video only while a recording was one page: as soon as the person moves to a second tab,
 * the stitched video holds what they watched end to end and the waiting is gone from it, so
 * everything logged after the first switch sits later in session time than it does on screen.
 * The narration drafter reads the log against the video, and would have described each step at
 * a moment it had not happened yet.
 *
 * Written beside the stitched video rather than over `actions.jsonl`, which stays the record of
 * what happened when: rewriting it in place would be wrong the second time a session was
 * imported, and there would be nothing left to recompute from.
 */
export function rebaseActionLog(sessionLogPath: string, videoLogPath: string, clips: RecordedClip[]): void {
  writeActionLog(videoLogPath, onVideoClock(readActionLog(sessionLogPath), clips))
}

export function onVideoClock(entries: ActionLogEntry[], clips: RecordedClip[]): ActionLogEntry[] {
  let videoMs = 0
  const windows = clips.map((clip) => {
    const window = { from: clip.fromSessionMs, to: clip.fromSessionMs + clip.durationMs, at: videoMs }
    videoMs += clip.durationMs
    return window
  })

  const rebased: ActionLogEntry[] = []
  for (const entry of entries) {
    // The last window takes its own end: a click that stopped the recording happened during it.
    const window = windows.find((candidate, index) =>
      index === windows.length - 1
        ? entry.t >= candidate.from && entry.t <= candidate.to
        : entry.t >= candidate.from && entry.t < candidate.to
    )
    // A stretch nobody watched is not in the video, so neither is anything logged during it.
    if (!window) continue

    rebased.push({ ...entry, t: Math.round(window.at + (entry.t - window.from)) })
  }

  return rebased.sort((first, second) => first.t - second.t)
}
