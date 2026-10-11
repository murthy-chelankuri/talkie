import type { TimelineItem, TranscriptSegment } from '../api/projectClient'
import { hasStaleVoice, segmentsForItem, voiceOf } from './clipNarration'

/**
 * How much of a project has a voice, and what is actually missing.
 *
 * These were one number, and it was wrong. A clip voiced before the voice setting changed still
 * has audio and still plays; counting it as "needing a voice" told someone with a finished
 * project that fifty-two clips were unvoiced, and told them to go and write the words they had
 * already written. Having no voice and having a different voice are different situations that
 * want different sentences, so they are counted separately.
 */
export interface VoiceProgress {
  /** No audio at all. The only clips that genuinely have no voice. */
  silent: TimelineItem[]
  /** Of those, the ones with no words to speak yet either. */
  unwritten: TimelineItem[]
  /** Has audio, read by a voice other than the one now chosen. Usable as it stands. */
  otherVoice: TimelineItem[]
  /** Clips with audio, whichever voice read it. */
  voiced: number
  /**
   * What "speak everything" acts on: the silent ones that have words, then the ones in another
   * voice. A clip with no words is not in it — there is nothing to speak, and counting it made the
   * button offer "Speak 1 clip", do nothing, and say nothing.
   */
  needing: TimelineItem[]
  /** The voice those other takes were read in, when they all agree on one. */
  previousVoice?: string
}

export function voiceProgress(
  timeline: TimelineItem[],
  segments: TranscriptSegment[],
  currentVoice: string
): VoiceProgress {
  const silent: TimelineItem[] = []
  const unwritten: TimelineItem[] = []
  const otherVoice: TimelineItem[] = []

  for (const item of timeline) {
    const segment = segmentsForItem(segments, item.id)[0]

    if (!segment || segment.status !== 'narrated') {
      silent.push(item)
      if (!segment?.text.trim()) unwritten.push(item)
      continue
    }

    if (hasStaleVoice(segments, item.id, currentVoice)) otherVoice.push(item)
  }

  const voices = new Set(otherVoice.map((item) => voiceOf(segments, item.id)).filter(Boolean))

  return {
    silent,
    unwritten,
    otherVoice,
    voiced: timeline.length - silent.length,
    needing: [...silent.filter((item) => !unwritten.includes(item)), ...otherVoice],
    previousVoice: voices.size === 1 ? ([...voices][0] as string) : undefined
  }
}

/**
 * What is left to do, said accurately.
 *
 * Returns null when there is nothing worth saying, which is its own kind of answer: a project
 * where every clip speaks in the chosen voice needs no instruction.
 */
export function voiceProgressHint(progress: VoiceProgress, currentVoice: string): string | null {
  const { silent, unwritten, otherVoice, previousVoice } = progress

  if (silent.length > 0) {
    const count = `${silent.length} clip${silent.length === 1 ? '' : 's'}`

    // Only tell someone to write when there is actually something unwritten.
    return unwritten.length === silent.length
      ? `${count} ${silent.length === 1 ? 'has' : 'have'} no narration yet. Write under a clip, then speak it.`
      : `${count} ${silent.length === 1 ? 'is' : 'are'} written but not spoken. Speak ${silent.length === 1 ? 'it' : 'them'} to add the audio.`
  }

  if (otherVoice.length > 0) {
    const count = `${otherVoice.length} clip${otherVoice.length === 1 ? '' : 's'}`
    const read = previousVoice ? `read by ${previousVoice}` : 'read by another voice'

    // Not a problem to fix — a choice to make. The audio is there and it plays.
    return `${count} ${otherVoice.length === 1 ? 'is' : 'are'} ${read}, not ${currentVoice}. Re-speak ${otherVoice.length === 1 ? 'it' : 'them'} to switch.`
  }

  return null
}

/** The label on the button that speaks everything still to be spoken. */
export function speakAllLabel(progress: VoiceProgress, currentVoice: string): string {
  const speakable = progress.silent.length - progress.unwritten.length
  if (speakable > 0) {
    return `Speak ${speakable} clip${speakable === 1 ? '' : 's'}`
  }
  if (progress.otherVoice.length > 0) {
    return `Re-speak ${progress.otherVoice.length} in ${currentVoice}`
  }
  // Nothing this button can do, but something left to do: say what, rather than "All voiced".
  if (progress.unwritten.length > 0) {
    const count = progress.unwritten.length
    return `${count} clip${count === 1 ? ' needs' : 's need'} words`
  }
  return 'All voiced'
}
