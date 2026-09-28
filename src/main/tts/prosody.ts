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
export const PITCH_TOP = 3
export const PITCH_BOTTOM = -1

/**
 * The stretch of the pitch fall this piece of speech covers.
 *
 * A take used to be one call to the voice, so the drift ran the length of the narration on its
 * own. Timed narration is read a beat at a time — separate processes, each starting from the
 * voice's baseline — so every beat restarted the contour, and a beat of a single sentence got
 * no contour at all. Four one-sentence beats came out as four identical flat utterances, which
 * is exactly how a person does not talk. Each beat is now told which part of the whole take's
 * fall it is responsible for.
 */
export interface PitchArc {
  from: number
  to: number
}

export const WHOLE_ARC: PitchArc = { from: PITCH_TOP, to: PITCH_BOTTOM }

/** Whether this piece of speech is the whole take rather than one beat of it. */
function isWholeArc(arc: PitchArc): boolean {
  return arc.from === PITCH_TOP && arc.to === PITCH_BOTTOM
}

/** The slice of the fall belonging to piece `index` of `total`. */
export function arcFor(index: number, total: number): PitchArc {
  return pitchArcFor(index, total, WHOLE_ARC)
}

/**
 * The slice of `whole` belonging to piece `index` of `total` — `arcFor` generalised to a range
 * other than the take's own top-to-bottom fall.
 *
 * Needed when a piece being synthesised is itself already a slice of the whole take (a beat), and
 * is being split further into clauses for a voice that cannot be trusted with `[[slnc]]`: each
 * clause needs its place in the beat's own slice of the fall, not a fresh fall of its own.
 */
export function pitchArcFor(index: number, total: number, whole: PitchArc): PitchArc {
  if (total <= 1) return whole
  const at = (step: number): number => whole.from + (whole.to - whole.from) * (step / total)
  return { from: at(index), to: at(index + 1) }
}

export function toSpokenMarkup(
  text: string,
  settings: ProsodySettings = DEFAULT_PROSODY,
  arc: PitchArc = WHOLE_ARC
): string {
  const sentences = splitSentences(sanitize(text))
  if (sentences.length === 0) return ''

  // `pbas` moves the pitch from wherever it already is rather than setting it outright, so
  // what each sentence emits is the step from the last one, not its own position. Emitting
  // positions directly leaves the pitch stuck high — measured as 200Hz, 206Hz, 182Hz for what
  // should have been a steady fall.
  let previous = 0
  const spoken = sentences.map((sentence, index) => {
    const target = pitchFor(index, sentences.length, arc)
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

/**
 * First sentence sits highest and the last lowest, drifting down in between.
 *
 * A lone sentence that is the whole take has no arc to sit on and takes the voice's own pitch;
 * raising it would leave every short narration sounding slightly high. A lone sentence that is
 * one beat of several does have a place in the fall, and sits at it — which is the difference
 * between a take with a contour and four identical flat utterances, since a beat is very often
 * a single sentence.
 */
function pitchFor(index: number, total: number, arc: PitchArc): number {
  if (total === 1) return isWholeArc(arc) ? 0 : Math.round(arc.from)
  const progress = index / (total - 1)
  return Math.round(arc.from + (arc.to - arc.from) * progress)
}

function withClausePauses(sentence: string, pauseMs: number): string {
  return splitClauses(sentence).join(`[[slnc ${Math.round(pauseMs)}]]`)
}

/** A sentence broken at the punctuation a speaker draws breath at, keeping it with the clause. */
export function splitClauses(sentence: string): string[] {
  // A speaker pauses after the comma, not before it.
  return sentence
    .split(/(?<=[,;:—–])\s+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)
}

export interface SpokenPiece {
  text: string
  /** Silence that follows this piece, before the next. Zero for the take's last piece. */
  pauseAfterMs: number
  /** This piece's own slice of the pitch fall — pass straight to `toSpokenMarkup`. */
  arc: PitchArc
}

/**
 * The same breakdown `toSpokenMarkup` embeds as `[[slnc]]` commands, handed back as separate
 * pieces instead of one string.
 *
 * For a voice that does not reliably honour embedded commands, the only pause left is real
 * silence spliced between separate recordings — see `voicePauseSupport.ts` for why some voices
 * need this and `sayTtsProvider.ts` for where these pieces are turned into one file again.
 */
export function toSpokenPieces(
  text: string,
  settings: ProsodySettings = DEFAULT_PROSODY,
  arc: PitchArc = WHOLE_ARC
): SpokenPiece[] {
  const sentences = splitSentences(sanitize(text))
  const clausesBySentence = sentences.map(splitClauses)
  const total = clausesBySentence.reduce((sum, clauses) => sum + clauses.length, 0)
  if (total === 0) return []

  const pieces: SpokenPiece[] = []
  let index = 0
  clausesBySentence.forEach((clauses, sentenceIndex) => {
    clauses.forEach((clauseText, clauseIndex) => {
      const isLastClauseOfSentence = clauseIndex === clauses.length - 1
      const isLastSentence = sentenceIndex === clausesBySentence.length - 1
      const pauseAfterMs =
        isLastClauseOfSentence && isLastSentence
          ? 0
          : isLastClauseOfSentence
            ? settings.sentencePauseMs
            : settings.clausePauseMs

      pieces.push({ text: clauseText, pauseAfterMs, arc: pitchArcFor(index, total, arc) })
      index += 1
    })
  })
  return pieces
}
