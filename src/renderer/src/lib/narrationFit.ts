import { TIMED_LINE } from '../../../main/transcript/narrationBeats'
import { FPS, NARRATION_LEAD_IN_FRAMES } from '../../../remotion/constants'

/**
 * Roughly how fast the voices read, in words a second. Measured off real takes of product
 * narration, which land between 2.5 and 3.1 — most near 3. Guessed at 2.6 first, that flagged
 * four scenes of five as too long whose takes all fitted; a warning that is usually wrong is one
 * nobody reads. The scene says "about" because it is still a guess until there is a take.
 */
export const WORDS_PER_SECOND = 2.9

/** The words a script will say aloud — its timings are read, not spoken. */
export function spokenWords(script: string): number {
  let count = 0
  for (const line of script.split('\n')) {
    const match = TIMED_LINE.exec(line)
    const words = (match ? match[2] : line).trim()
    if (words) count += words.split(/\s+/).length
  }
  return count
}

/** How long a script takes to say, before any voice has read it. */
export function estimatedSpokenSeconds(script: string): number {
  return spokenWords(script) / WORDS_PER_SECOND
}

export type NarrationFit = {
  /** How long the words take — measured off the take once there is one, estimated until then. */
  seconds: number
  measured: boolean
  /** Whether they run past the end of the clip. */
  long: boolean
}

/**
 * Whether a clip's narration can be said in the time the clip runs.
 *
 * Only the words count against the clip, not the pauses its timings ask for: `placeBeats`
 * shortens those in proportion when the take would overrun, so a timed script only fails to fit
 * when there is more to say than there is time to say it in. The composition's lead-in is
 * counted, because the voice starts that much after the picture does.
 */
export function narrationFit(script: string, clipFrames: number, takeSeconds?: number | null): NarrationFit {
  const measured = takeSeconds != null && takeSeconds > 0
  const seconds = measured ? takeSeconds : estimatedSpokenSeconds(script)
  const room = (clipFrames - NARRATION_LEAD_IN_FRAMES) / FPS
  return { seconds, measured, long: seconds > room }
}

/**
 * The script cut into what is typed: timing marks and the words after them.
 *
 * The script view paints the marks as chips underneath the textarea, so every character here
 * has to be the one typed, in order — joining the parts gives back exactly the text.
 */
export function scriptParts(script: string): { text: string; mark: boolean }[] {
  const parts: { text: string; mark: boolean }[] = []
  const lines = script.split('\n')
  lines.forEach((line, index) => {
    const match = TIMED_LINE.exec(line)
    if (match) {
      const markLength = line.length - match[2].length
      // The mark is the bracket and its time; the space after it is part of the words, so a
      // chip ends where the bracket does.
      const mark = line.slice(0, markLength).trimEnd()
      parts.push({ text: mark, mark: true })
      parts.push({ text: line.slice(mark.length), mark: false })
    } else {
      parts.push({ text: line, mark: false })
    }
    if (index < lines.length - 1) parts.push({ text: '\n', mark: false })
  })
  return parts.filter((part) => part.text.length > 0)
}
