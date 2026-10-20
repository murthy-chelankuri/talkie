import { homedir } from 'os'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { findProjectDir } from '../project/paths'
import {
  readTranscript,
  fitClipToNarration,
  updateTranscriptSegmentAudio
} from '../project/projectApi'
import { readSettings } from '../settings/settingsStore'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../composition/constants'
import { RECORDED_VOICE } from './schema'
import type { TranscriptSegment } from './schema'
import { runFfmpeg } from '../media'
import { TAKE_LOUDNESS, measuredLoudnessFilter, singlePassLoudnessFilter } from '../render/loudness'
import { cleanVoiceFilterFor } from './cleanVoice'

/**
 * The browser captures at 48kHz; keeping that rather than dropping to the synthesiser's 22050
 * keeps the half of the voice's bandwidth that downsampling would throw away. Nothing
 * downstream requires one rate — only one container and encoding.
 */
const SAMPLE_RATE = '48000'

const WAV = ['-ac', '1', '-ar', SAMPLE_RATE, '-c:a', 'pcm_s16le']

/**
 * Save a take the user recorded in their own voice.
 *
 * The browser records webm/opus, which is converted here so the rest of the pipeline — duration
 * measurement, the asset server, the composition — keeps seeing plain WAV. The narration text is
 * left alone: it is the script, and it stays useful to read from whether or not a voice has been
 * recorded over it.
 *
 * The recording is kept as it was heard, beside the take made from it, so the clean-up can be
 * switched for this take later (`setRecordingCleanUp`). Whether it is cleaned to begin with is
 * the setting's.
 */
export async function saveRecordedNarration(
  projectId: string,
  segmentId: string,
  recording: Uint8Array,
  baseDir: string = homedir()
): Promise<TranscriptSegment> {
  const { dir, segment } = findSegment(projectId, segmentId, baseDir)

  const audioDir = join(dir, 'audio')
  mkdirSync(audioDir, { recursive: true })

  // A new file per take, as with synthesis, so undo can still reach the take before this one.
  const stamp = Date.now()
  const sourcePath = join(audioDir, `${segmentId}-${stamp}.webm`)
  const originalFileName = `${segmentId}-${stamp}.original.wav`

  writeFileSync(sourcePath, recording)
  try {
    await runFfmpeg(['-i', sourcePath, ...WAV, '-y', join(audioDir, originalFileName)])
  } catch (err) {
    rmSync(join(audioDir, originalFileName), { force: true })
    throw new Error(`Could not save the recording: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    rmSync(sourcePath, { force: true })
  }

  const clean = readSettings(baseDir).speech.cleanRecordings
  return takeFromOriginal(projectId, audioDir, segment, originalFileName, clean, baseDir)
}

/**
 * Clean up a recorded take, or put it back as it was heard — always from the recording itself,
 * so switching back and forth never cleans a take twice.
 *
 * A new file each time, like every other take, so undo reaches the one before.
 */
export async function setRecordingCleanUp(
  projectId: string,
  segmentId: string,
  clean: boolean,
  baseDir: string = homedir()
): Promise<TranscriptSegment> {
  const { dir, segment } = findSegment(projectId, segmentId, baseDir)
  const original = segment.recording?.original
  if (segment.voice !== RECORDED_VOICE || !original) {
    throw new Error('Only a take recorded in your own voice since Talkie kept the recording can be cleaned up.')
  }
  if (!existsSync(join(dir, 'audio', original))) {
    throw new Error('The recording this take was made from is missing, so it cannot be made again.')
  }
  if (segment.recording?.cleaned === clean) return segment

  return takeFromOriginal(projectId, join(dir, 'audio'), segment, original, clean, baseDir)
}

async function takeFromOriginal(
  projectId: string,
  audioDir: string,
  segment: TranscriptSegment,
  originalFileName: string,
  clean: boolean,
  baseDir: string
): Promise<TranscriptSegment> {
  const originalPath = join(audioDir, originalFileName)
  const audioFileName = `${segment.id}-${Date.now()}.wav`
  const audioPath = join(audioDir, audioFileName)

  try {
    const cleanUp = clean ? await cleanVoiceFilterFor(originalPath) : undefined
    // Level with the synthesised takes, or the video jumps in volume at every cut between
    // a spoken clip and a synthesised one. See loudness.ts. Measured after the clean-up, which
    // leaves a take quieter than it was recorded.
    const level = (await measuredLoudnessFilter(originalPath, TAKE_LOUDNESS, cleanUp)) ?? singlePassLoudnessFilter(TAKE_LOUDNESS)
    await runFfmpeg(['-i', originalPath, '-af', cleanUp ? `${cleanUp},${level}` : level, ...WAV, '-y', audioPath])
  } catch (err) {
    rmSync(audioPath, { force: true })
    throw new Error(`Could not save the recording: ${err instanceof Error ? err.message : String(err)}`)
  }

  const spokenFrames = Math.max(1, Math.round(getWavDurationSeconds(audioPath) * FPS))
  const needed = NARRATION_LEAD_IN_FRAMES + spokenFrames + NARRATION_TAIL_FRAMES

  // The clip has to hold the whole take plus the pauses either side, exactly as for synthesis.
  // A recording is never shortened to fit, and a scene that needs longer moves its cut later
  // rather than running into the footage the scene after it is about to play.
  fitClipToNarration(projectId, segment.timelineItemId, needed, baseDir)

  return updateTranscriptSegmentAudio(projectId, segment.id, audioFileName, RECORDED_VOICE, baseDir, {
    original: originalFileName,
    cleaned: clean
  })
}

function findSegment(projectId: string, segmentId: string, baseDir: string): { dir: string; segment: TranscriptSegment } {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${projectId}`)
  }

  const segment = readTranscript(projectId, baseDir).find((candidate) => candidate.id === segmentId)
  if (!segment) {
    throw new Error(`No transcript segment found with id ${segmentId}`)
  }
  return { dir, segment }
}
