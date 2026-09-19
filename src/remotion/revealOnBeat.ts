import { NARRATION_LEAD_IN_FRAMES } from './constants'

/**
 * When each line of a slide should appear, given when its narration is spoken.
 *
 * A slide used to reveal its lines on a fixed stagger — a fifth of a second apart, so a
 * three-line slide was fully drawn about a second in, whatever the voice was doing. That is an
 * entrance rather than an explanation: by the time the narration reaches the third point, the
 * viewer read it twenty seconds ago and has been waiting.
 *
 * Narration already knows when each thing is said. A timed take is a list of moments, so the
 * lines can wait for theirs.
 *
 * The beats are matched to the lines from the end. A slide is nearly always introduced before
 * its first point — "here is what it does" and then the points — so the opening beat belongs
 * to the title, not to line one. Counting back from the last beat puts each line with the
 * sentence about it whether or not there is an introduction, which is the thing that would
 * otherwise have to be guessed.
 */

/** How far apart lines appear when there is nothing to time them to. */
export const FALLBACK_STAGGER_FRAMES = 6

export interface Beat {
  at: number
  text: string
}

export function revealFrames(lineCount: number, beats: Beat[], fps: number): number[] {
  if (lineCount <= 0) return []

  // No timings: the old rhythm, which at least brings them in one at a time.
  if (beats.length === 0) {
    return Array.from({ length: lineCount }, (_, index) => index * FALLBACK_STAGGER_FRAMES)
  }

  // Beats spent before the first line — an introduction, usually exactly one.
  const intro = Math.max(0, beats.length - lineCount)

  return Array.from({ length: lineCount }, (_, index) => {
    const beat = beats[Math.min(index + intro, beats.length - 1)]
    // The take starts where the composition drops it in, so a beat's own time is measured from
    // there rather than from the first frame of the clip.
    return NARRATION_LEAD_IN_FRAMES + Math.round(beat.at * fps)
  })
}
