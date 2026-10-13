import { homedir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { findProjectDir } from '../project/paths'
import {
  readTranscript,
  fitClipToNarration,
  updateTranscriptSegmentAudio
} from '../project/projectApi'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../remotion/constants'
import { RECORDED_VOICE } from './schema'
import type { TranscriptSegment } from './schema'
import { runFfmpeg } from '../media'
import { TAKE_LOUDNESS, measuredLoudnessFilter, singlePassLoudnessFilter } from '../render/loudness'

/**
 * The browser captures at 48kHz; keeping that rather than dropping to the synthesiser's 22050
 * keeps the half of the voice's bandwidth that downsampling would throw away. Nothing
 * downstream requires one rate — only one container and encoding.
 */
const SAMPLE_RATE = '48000'

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
    await runFfmpeg([
        '-i',
        sourcePath,
        '-af',
        // Level with the synthesised takes, or the video jumps in volume at every cut between
        // a spoken clip and a synthesised one. See loudness.ts.
        (await measuredLoudnessFilter(sourcePath, TAKE_LOUDNESS)) ?? singlePassLoudnessFilter(TAKE_LOUDNESS),
        '-ac',
        '1',
        '-ar',
        SAMPLE_RATE,
        '-c:a',
        'pcm_s16le',
        '-y',
        audioPath
    ])
  } catch (err) {
    rmSync(sourcePath, { force: true })
    throw new Error(`Could not save the recording: ${err instanceof Error ? err.message : String(err)}`)
  }
  rmSync(sourcePath, { force: true })

  const spokenFrames = Math.max(1, Math.round(getWavDurationSeconds(audioPath) * FPS))
  const needed = NARRATION_LEAD_IN_FRAMES + spokenFrames + NARRATION_TAIL_FRAMES

  // The clip has to hold the whole take plus the pauses either side, exactly as for synthesis.
  // A recording is never shortened to fit, and a scene that needs longer moves its cut later
  // rather than running into the footage the scene after it is about to play.
  fitClipToNarration(projectId, segment.timelineItemId, needed, baseDir)

  return updateTranscriptSegmentAudio(projectId, segmentId, audioFileName, RECORDED_VOICE, baseDir)
}
