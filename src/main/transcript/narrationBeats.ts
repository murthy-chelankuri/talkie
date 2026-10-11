import type { NarrationBeat } from './schema'

/**
 * Narration as a handful of things said at particular moments, rather than one unbroken block.
 *
 * A clip is not a constant stream of events. In a real recording a screen sits for sixteen
 * seconds waiting for an analysis and then takes ten clicks in eleven, and narration read
 * straight through arrives at the end with everything already said. The drafter is given the
 * action log with its timings, so it is the one thing that knows which sentence belongs to which
 * moment — it is asked to say so, and this reads the answer back.
 *
 * The format is a leading `[12.3]` on each line, because it survives a model that also wants to
 * add a blank line or lose a bracket, and because a draft that arrives with no timings at all is
 * still perfectly good narration — it simply plays as one beat, the way every take used to.
 */
export const TIMED_LINE = /^\s*[[(]\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?\s*[\])]\s*(.*)$/

export function parseBeats(draft: string): NarrationBeat[] {
  const beats: NarrationBeat[] = []

  for (const line of draft.split('\n')) {
    const match = TIMED_LINE.exec(line)
    if (!match) {
      // A continuation of the line before it, which is how a model wraps a long sentence.
      const text = line.trim()
      if (text && beats.length > 0) {
        beats[beats.length - 1] = {
          ...beats[beats.length - 1],
          text: `${beats[beats.length - 1].text} ${text}`.trim()
        }
      }
      continue
    }

    const text = match[2].trim()
    if (text) beats.push({ at: Number(match[1]), text })
  }

  // Time only ever runs forwards. A model that puts a beat before the one in front of it has
  // made an ordering mistake, not asked for two things to be said at once.
  //
  // Punctuated here rather than as each line is read, so a line the model wrapped is joined on
  // before the full stop goes at the end of the whole beat rather than into the middle of it.
  return beats
    .map((beat, index) => ({
      ...beat,
      at: Math.max(beat.at, index === 0 ? 0 : beats[index - 1].at),
      text: finished(beat.text)
    }))
    .filter((beat) => beat.text.length > 0)
}

/**
 * A line with something to fall on at the end of it.
 *
 * A model asked for short timed lines often leaves the full stop off, and the voice has nothing
 * to end on: `say` falls at a full stop and runs flat without one, so a beat written without
 * punctuation is read as though the sentence were going to continue — and then stops dead. Read
 * one after another that is what makes a take sound recited. It also keeps the prose readable,
 * since the beats are joined with a space to make it.
 */
function finished(text: string): string {
  if (text.length === 0) return text
  return /[.!?…:;,—–]$/.test(text) ? text : `${text}.`
}

/**
 * Narration as written, split into the prose to store and the timings to read it by.
 *
 * Every way words reach a segment goes through here — the editor, the script view, MCP — so a
 * take written with timings keeps them whatever wrote it. Editing used to drop them silently:
 * `updateTranscriptSegmentText` cleared `beats`, so any hand-edit downgraded a timed take to one
 * flat block and quietly undid the thing that keeps narration in step with the picture.
 */
export function narrationFromText(written: string): { text: string; beats: NarrationBeat[] } {
  const beats = parseBeats(written)
  return beats.length > 0 ? { text: beatsToText(beats), beats } : { text: written.trim(), beats: [] }
}

/** The narration as one piece of prose, which is what the editor shows and the user edits. */
export function beatsToText(beats: NarrationBeat[]): string {
  return beats.map((beat) => beat.text).join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Where each beat should start, in seconds from the beginning of the clip.
 *
 * A beat is held back to its own moment but never dragged earlier than the end of the one before
 * it, and the whole take is shifted off the start of the clip by the beat of silence the
 * composition already leaves. If the timings would run the take past the end of the footage, the
 * waits are shortened in proportion rather than dropped: keeping some of the shape is worth more
 * than keeping the first few gaps at full length and cramming everything after them.
 */
export function placeBeats(
  beats: NarrationBeat[],
  spokenSeconds: number[],
  options: { leadInSeconds: number; roomSeconds: number }
): number[] {
  const wanted: number[] = []
  let cursor = options.leadInSeconds

  for (const [index, beat] of beats.entries()) {
    const at = Math.max(beat.at, cursor)
    wanted.push(at)
    cursor = at + (spokenSeconds[index] ?? 0)
  }

  const speech = spokenSeconds.reduce((total, seconds) => total + seconds, 0)
  const overrun = cursor - options.roomSeconds
  if (overrun <= 0) return wanted

  // Only the waiting can give: the words themselves take as long as they take.
  const waiting = cursor - options.leadInSeconds - speech
  if (waiting <= 0) return wanted
  const keep = Math.max(0, (waiting - overrun) / waiting)

  const squeezed: number[] = []
  let at = options.leadInSeconds
  for (const [index, want] of wanted.entries()) {
    const gap = want - (index === 0 ? options.leadInSeconds : wanted[index - 1] + spokenSeconds[index - 1])
    at = (index === 0 ? options.leadInSeconds : at + spokenSeconds[index - 1]) + gap * keep
    squeezed.push(at)
  }

  return squeezed
}
