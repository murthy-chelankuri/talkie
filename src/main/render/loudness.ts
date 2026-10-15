import { readFileSync, renameSync, rmSync } from 'fs'
import { runFfmpeg } from '../media'
import { readWavFormat } from '../tts/wavDuration'

/**
 * How loud speech should sit: integrated loudness in LUFS, the ceiling for true peaks in dBTP,
 * and how much range is allowed between quiet and loud passages.
 */
export interface LoudnessTarget {
  integrated: number
  truePeak: number
  range: number
}

/**
 * Where every take is put, whichever voice made it.
 *
 * Measured from the synthesised narration in a real project, which sat between -17.5 and -18.0
 * LUFS with the built-in voices. A recorded take was already brought here; a take from a cloud
 * engine was not, and nothing made it land anywhere near — so a project that mixed them could
 * jump in volume every time it cut between one clip and the next. Bringing every take to one
 * level is what makes three sources sound like one recording.
 */
export const TAKE_LOUDNESS: LoudnessTarget = { integrated: -17.5, truePeak: -1.5, range: 11 }

/**
 * Where the finished video is put.
 *
 * -16 LUFS is what spoken content is delivered at on the web: quiet enough that a platform
 * normalising to -14 has headroom to lift it without clipping, loud enough that it is not the
 * quietest thing in someone's feed. Takes are already level with each other by this point, so
 * this lifts the whole mix rather than reshaping any part of it.
 */
export const DELIVERY_LOUDNESS: LoudnessTarget = { integrated: -16, truePeak: -1.5, range: 11 }

function baseFilter(target: LoudnessTarget): string {
  return `loudnorm=I=${target.integrated}:TP=${target.truePeak}:LRA=${target.range}`
}

/**
 * The loudness filter for this file, measured first.
 *
 * Measuring and then correcting by a known amount keeps a quiet passage quiet relative to a
 * loud one; normalising in a single pass chases the level as it goes and breathes audibly on
 * speech.
 *
 * Null when there is nothing to measure — no audio stream, or nothing but silence — which is a
 * file to leave alone rather than one to raise by an infinite amount.
 */
export async function measuredLoudnessFilter(sourcePath: string, target: LoudnessTarget): Promise<string | null> {
  const base = baseFilter(target)

  try {
    // Audio only: the null muxer would otherwise want the picture encoded too, which a loudness
    // reading has no use for.
    const result = await runFfmpeg(['-i', sourcePath, '-vn', '-af', `${base}:print_format=json`, '-f', 'null', '-'])

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    const json = output.slice(output.lastIndexOf('{'), output.lastIndexOf('}') + 1)
    if (!json) return null
    const measured = JSON.parse(json) as Record<string, string>
    if (!Number.isFinite(parseFloat(measured.input_i))) return null

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
    // A video exported before anything was narrated has no soundtrack at all. That is not a
    // fault, and logging it as one on every such export would bury the ones that are.
    if (!/does not contain any stream/i.test(String(err))) console.error('Could not measure loudness:', err)
    return null
  }
}

/** The filter to fall back on when a measurement cannot be had: one pass, still bounded. */
export function singlePassLoudnessFilter(target: LoudnessTarget): string {
  return baseFilter(target)
}

/**
 * Bring a synthesised take to the level every other take sits at, in place.
 *
 * Kept at the take's own rate and channel count: the rest of the app reads timing off the wav
 * header, and a take that came back at 192 kHz — which is what loudnorm works at internally —
 * would be four times the size and no better. Never fatal: a take at the wrong level is still a
 * take, and failing narration over it would be a worse outcome than a clip that is a little loud.
 */
export async function levelTake(wavPath: string, target: LoudnessTarget = TAKE_LOUDNESS): Promise<void> {
  const filter = await measuredLoudnessFilter(wavPath, target)
  if (!filter) return

  const format = readWavFormat(wavPath)
  const levelled = `${wavPath}.levelled.wav`
  try {
    await runFfmpeg([
        '-i',
        wavPath,
        '-af',
        filter,
        '-ar',
        String(format.sampleRate),
        '-ac',
        String(format.channels),
        '-c:a',
        'pcm_s16le',
        '-y',
        levelled
    ])
    // A file that came back empty is not a replacement for one that had speech in it.
    if (readFileSync(levelled).length > 44) renameSync(levelled, wavPath)
  } catch (err) {
    console.error('Could not level the take, keeping it as synthesised:', err)
  } finally {
    rmSync(levelled, { force: true })
  }
}

/**
 * The finished video's soundtrack, brought to the delivery level — the picture copied untouched.
 *
 * A separate pass after the render rather than a setting on it, because loudness has to be
 * measured over the whole film before anything can be corrected, and the whole film only exists
 * once it has been rendered. Copying the video stream means this costs seconds, not a re-encode.
 * AAC is ffmpeg's own encoder, which carries none of the licence x264 would.
 *
 * Returns whether the file was changed. A video with no narration has no audio stream and is
 * left exactly as rendered; so is one where this fails, because a finished export that is a
 * little quiet is better than an export that failed.
 */
export async function levelExport(mp4Path: string, target: LoudnessTarget = DELIVERY_LOUDNESS): Promise<boolean> {
  const filter = await measuredLoudnessFilter(mp4Path, target)
  if (!filter) return false

  const levelled = mp4Path.replace(/\.mp4$/, '.levelled.mp4')
  try {
    await runFfmpeg([
        '-i',
        mp4Path,
        '-map',
        '0:v',
        '-map',
        '0:a',
        '-c:v',
        'copy',
        '-af',
        filter,
        // loudnorm resamples to 192 kHz to find true peaks; 48 kHz is what video is delivered at.
        '-ar',
        '48000',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        '-y',
        levelled
    ])
    renameSync(levelled, mp4Path)
    return true
  } catch (err) {
    console.error('Could not level the export, keeping it as rendered:', err)
    return false
  } finally {
    rmSync(levelled, { force: true })
  }
}
