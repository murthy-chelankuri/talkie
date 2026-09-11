import { homedir } from 'os'
import { existsSync } from 'fs'
import { join } from 'path'
import { findProjectDir } from '../project/paths'
import { readTimeline, readTranscript, updateTimelineItemDuration } from '../project/projectApi'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../remotion/constants'

/**
 * Make sure every clip is long enough to finish saying what it has to say.
 *
 * Narration is held back a beat and the clip holds a beat after it, so a clip needs to be
 * longer than its audio by both. Narration recorded before those pauses existed sits on clips
 * sized to the audio alone, and the delay then pushes the end of the speech past the cut — the
 * voice is clipped mid-word as the next slide arrives.
 *
 * Clips are only ever lengthened. A clip someone has deliberately stretched, or a recording
 * longer than its narration, is left as it is.
 */
export function repairNarrationDurations(projectId: string, baseDir: string = homedir()): number {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) return 0

  let transcript: ReturnType<typeof readTranscript>
  let timeline: ReturnType<typeof readTimeline>
  try {
    transcript = readTranscript(projectId, baseDir)
    timeline = readTimeline(projectId, baseDir)
  } catch (err) {
    console.error(`Could not check narration timing for ${projectId}:`, err)
    return 0
  }

  let repaired = 0
  for (const item of timeline) {
    const segment = transcript.find((candidate) => candidate.timelineItemId === item.id)
    if (!segment?.audioFile) continue

    const audioPath = join(dir, 'audio', segment.audioFile)
    if (!existsSync(audioPath)) continue

    let audioFrames: number
    try {
      audioFrames = Math.max(1, Math.round(getWavDurationSeconds(audioPath) * FPS))
    } catch (err) {
      console.error(`Could not measure ${audioPath}:`, err)
      continue
    }

    const needed = NARRATION_LEAD_IN_FRAMES + audioFrames + NARRATION_TAIL_FRAMES
    if (item.duration >= needed) continue

    updateTimelineItemDuration(projectId, item.id, needed, baseDir)
    repaired += 1
  }

  return repaired
}
