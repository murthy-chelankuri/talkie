import { homedir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { RenderInternals } from '@remotion/renderer'
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
import { ffOptions } from '../render/binaries'

/**
 * The browser captures at 48kHz; keeping that rather than dropping to the synthesiser's 22050
 * keeps the half of the voice's bandwidth that downsampling would throw away. Nothing
 * downstream requires one rate — only one container and encoding.
 */
const SAMPLE_RATE = '48000'

/**
 * Loudness to normalise a take to, in LUFS.
 *
 * Measured from the synthesised narration in a real project, which sits between -17.5 and
 * -18.0 LUFS: a recorded take has to land in the same place or the video jumps in volume every
 * time it cuts between a spoken clip and a synthesised one.
 */
const TARGET_LUFS = -17.5
const TARGET_TRUE_PEAK = -1.5
const TARGET_RANGE = 11

/**
 * Build the loudness filter for this take, measuring it first.
 *
 * Measuring and then correcting by a known amount keeps a quiet passage quiet relative to a
 * loud one; normalising in a single pass would chase the level as it goes and breathe audibly
 * on speech. If the measurement cannot be read the filter still runs, just without it.
 */
async function loudnessFilter(sourcePath: string): Promise<string> {
  const base = `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK}:LRA=${TARGET_RANGE}`

  try {
    const result = await RenderInternals.callFf({
      bin: 'ffmpeg',
      args: ['-i', sourcePath, '-af', `${base}:print_format=json`, '-f', 'null', '-'],
      ...ffOptions(),
      logLevel: 'info',
      cancelSignal: undefined
    })

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    const measured = JSON.parse(output.slice(output.lastIndexOf('{'), output.lastIndexOf('}') + 1)) as Record<
      string,
      string
    >

    return [
      base,
      `measured_I=${measured.input_i}`,
      `measured_TP=${measured.input_tp}`,
      `measured_LRA=${measured.input_lra}`,
      `measured_thresh=${measured.input_thresh}`,
      `offset=${measured.target_offset}`,
      'linear=true'
    ].join(':')
  } catch (err) {
    console.error('Could not measure the recording loudness, normalising in one pass:', err)
    return base
  }
}

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
      args: [
        '-i',
        sourcePath,
        '-af',
        await loudnessFilter(sourcePath),
        '-ac',
        '1',
        '-ar',
        SAMPLE_RATE,
        '-c:a',
        'pcm_s16le',
        '-y',
        audioPath
      ],
      ...ffOptions(),
      cancelSignal: undefined
    })
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
