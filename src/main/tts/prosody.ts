/**
 * Turn narration into speech markup that sounds like someone explaining rather than reading.
 *
 * macOS `say` accepts inline commands in double brackets, and three of them do most of the
 * work: `slnc` for silence, `rate` for pace, and `pbas` for pitch. Pitch is written as a
 * relative offset because a voice's own baseline differs — measured on this machine, `pbas +3`
 * moved Samantha from 181Hz to 204Hz and Daniel from 120Hz to 134Hz, so the same offset suits
 * both, where an absolute value would suit neither.
 */

export interface ProsodySettings {
  /** Words per minute. Explaining runs slower than reading aloud. */
  pace: number
  /** Silence after a full stop. */
  sentencePauseMs: number
  /** Silence at a comma or dash, where a speaker draws breath. */
  clausePauseMs: number
}

export const DEFAULT_PROSODY: ProsodySettings = {
  pace: 170,
  sentencePauseMs: 420,
  // An explicit pause replaces the one `say` would have made rather than adding to it, so
  // anything near its own ~200ms comma pause is no pause at all.
  clausePauseMs: 300
}

/**
 * Where pitch starts and ends across a paragraph, in `pbas` units relative to the voice's own
 * baseline. Speech drifts down as a thought is developed, which is what stops it sounding
 * recited; roughly 15 units is an octave here, so this is a few semitones.
 *
 * Both ends were measured rather than guessed. A range half this wide was smaller than the
 * natural variation between one sentence and the next and did nothing audible; a range twice
 * this wide fell from 200Hz to 126Hz, which is too far to sound like the same person.
 */
const PITCH_TOP = 3
const PITCH_BOTTOM = -1

export function toSpokenMarkup(text: string, settings: ProsodySettings = DEFAULT_PROSODY): string {
  const sentences = splitSentences(sanitize(text))
  if (sentences.length === 0) return ''

  // `pbas` moves the pitch from wherever it already is rather than setting it outright, so
  // what each sentence emits is the step from the last one, not its own position. Emitting
  // positions directly leaves the pitch stuck high — measured as 200Hz, 206Hz, 182Hz for what
  // should have been a steady fall.
  let previous = 0
  const spoken = sentences.map((sentence, index) => {
    const target = pitchFor(index, sentences.length)
    const step = target - previous
    previous = target
    const sign = step >= 0 ? '+' : ''
    return `[[pbas ${sign}${step}]]${withClausePauses(sentence, settings.clausePauseMs)}`
  })

  return `[[rate ${Math.round(settings.pace)}]]${spoken.join(`[[slnc ${Math.round(settings.sentencePauseMs)}]]`)}`
}

/**
 * Narration is written by people and by models, and either could contain the brackets `say`
 * treats as a command. Breaking them up means text is always spoken, never executed.
 */
function sanitize(text: string): string {
  return text.replace(/\[\[/g, '[ [').replace(/\]\]/g, '] ]')
}

/** Keep the punctuation with its sentence: the voice needs it to fall at a full stop. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
}

/** First sentence sits highest and the last lowest, drifting down in between. */
function pitchFor(index: number, total: number): number {
  if (total === 1) return 0
  const progress = index / (total - 1)
  return Math.round(PITCH_TOP + (PITCH_BOTTOM - PITCH_TOP) * progress)
}

function withClausePauses(sentence: string, pauseMs: number): string {
  // A speaker pauses after the comma, not before it.
  return sentence.replace(/([,;:—–])\s+/g, `$1[[slnc ${Math.round(pauseMs)}]]`)
}
