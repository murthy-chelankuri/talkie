import { homedir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { RenderInternals } from '@remotion/renderer'
import { findProjectDir } from '../project/paths'
import {
  readTimeline,
  readTranscript,
  updateTimelineItemDuration,
  updateTranscriptSegmentAudio
} from '../project/projectApi'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../remotion/constants'
import { RECORDED_VOICE } from './schema'
import type { TranscriptSegment } from './schema'

/** Matches what the speech synthesiser writes, so everything downstream sees one audio format. */
const SAMPLE_RATE = '22050'

/**
 * Save a take the user recorded in their own voice.
 *
 * The browser records webm/opus, which is converted here so the rest of the pipeline — duration
 * measurement, the asset server, the composition — keeps seeing plain WAV. The narration text is
 * left alone: it is the script, and it stays useful to read from whether or not a voice has been
 * recorded over it.
 */
export async function saveRecordedNarration(
  projectId: string,
  segmentId: string,
  recording: Uint8Array,
  baseDir: string = homedir()
): Promise<TranscriptSegment> {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${projectId}`)
  }

  const segment = readTranscript(projectId, baseDir).find((candidate) => candidate.id === segmentId)
  if (!segment) {
    throw new Error(`No transcript segment found with id ${segmentId}`)
  }

  const audioDir = join(dir, 'audio')
  mkdirSync(audioDir, { recursive: true })

  // A new file per take, as with synthesis, so undo can still reach the take before this one.
  const sourcePath = join(audioDir, `${segmentId}-${Date.now()}.webm`)
  const audioFileName = `${segmentId}-${Date.now()}.wav`
  const audioPath = join(audioDir, audioFileName)

  writeFileSync(sourcePath, recording)
  try {
    await RenderInternals.callFf({
      bin: 'ffmpeg',
      args: ['-i', sourcePath, '-ac', '1', '-ar', SAMPLE_RATE, '-c:a', 'pcm_s16le', '-y', audioPath],
      indent: false,
      logLevel: 'error',
      binariesDirectory: null,
      cancelSignal: undefined
    })
  } catch (err) {
    rmSync(sourcePath, { force: true })
    throw new Error(`Could not save the recording: ${err instanceof Error ? err.message : String(err)}`)
  }
  rmSync(sourcePath, { force: true })

  const spokenFrames = Math.max(1, Math.round(getWavDurationSeconds(audioPath) * FPS))
  const needed = NARRATION_LEAD_IN_FRAMES + spokenFrames + NARRATION_TAIL_FRAMES

  // The clip has to hold the whole take plus the pauses either side, exactly as for synthesis,
  // and a recording must never be shortened to fit a clip.
  const linkedItem = readTimeline(projectId, baseDir).find((item) => item.id === segment.timelineItemId)
  if (linkedItem) {
    const nextDuration = linkedItem.kind === 'video' ? Math.max(linkedItem.duration, needed) : needed
    updateTimelineItemDuration(projectId, segment.timelineItemId, nextDuration, baseDir)
  }

  return updateTranscriptSegmentAudio(projectId, segmentId, audioFileName, RECORDED_VOICE, baseDir)
}
