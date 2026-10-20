import { runFfmpeg } from '../media'
import type { FootageCuts } from './sceneBoundaries'

/**
 * How different two frames must be to count as a new shot, from 0 to 1 (ffmpeg's scene score).
 *
 * A screen recording changes a great deal without cutting — a page scrolls, a dialog opens — and
 * every one of those taken for a cut would chop a walkthrough into five-second scenes. A real
 * cut replaces the whole picture and scores far above this; scrolling stays well under it.
 */
export const SHOT_THRESHOLD = 0.4

/** Holding still at least this long is the screen waiting, as IDLE_GAP_MS is for a recording. */
export const STILL_SECONDS = 2

/** A gap in the speech at least this long is between sentences rather than between words. */
export const PAUSE_SECONDS = 0.4

/**
 * Everything is read at this rate. A cut is found to a tenth of a second, which is closer than a
 * scene boundary needs, and a long video is read in a fraction of the time every frame would take.
 */
const SAMPLE_FPS = 10

/** The ffmpeg command that reports where a video's shots change, holds still and pauses. */
export function footageCutArgs(path: string, hasAudio: boolean): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    path,
    // Small and slow is all the measuring needs; the picture is only compared, never kept.
    '-filter:v',
    `fps=${SAMPLE_FPS},scale=320:-2,freezedetect=n=0.003:d=${STILL_SECONDS},select='gt(scene,${SHOT_THRESHOLD})',showinfo`,
    ...(hasAudio ? ['-filter:a', `silencedetect=n=-35dB:d=${PAUSE_SECONDS}`] : ['-an']),
    '-f',
    'null',
    '-'
  ]
}

/**
 * What ffmpeg said, as moments in the video. Pure, because ffmpeg's wording is the part that can
 * change under us and is worth pinning down in a test.
 *
 * ffmpeg reports times on the file's own clock, which need not start at zero; the player's does,
 * so `startSeconds` (probeMedia's) is taken off every one.
 */
export function readFootageCuts(stderr: string, startSeconds = 0): FootageCuts {
  const ms = (seconds: number): number => Math.round((seconds - startSeconds) * 1000)
  const shotsMs: number[] = []
  const stillsEndMs: number[] = []
  const pausesMs: number[] = []

  for (const line of stderr.split('\n')) {
    const shot = /Parsed_showinfo.*\bpts_time:\s*(-?[\d.]+)/.exec(line)
    if (shot) shotsMs.push(ms(Number(shot[1])))

    const still = /freeze_end:\s*(-?[\d.]+)/.exec(line)
    if (still) stillsEndMs.push(ms(Number(still[1])))

    const pause = /silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/.exec(line)
    if (pause) pausesMs.push(ms(Number(pause[1]) - Number(pause[2]) / 2))
  }

  const usable = (values: number[]): number[] => values.filter((value) => Number.isFinite(value) && value > 0)
  return { shotsMs: usable(shotsMs), stillsEndMs: usable(stillsEndMs), pausesMs: usable(pausesMs) }
}

/** Where a video's picture and sound suggest it could be cut. */
export async function findFootageCuts(
  path: string,
  { hasAudio, startSeconds }: { hasAudio: boolean; startSeconds: number }
): Promise<FootageCuts> {
  const { stderr } = await runFfmpeg(footageCutArgs(path, hasAudio))
  return readFootageCuts(stderr, startSeconds)
}
