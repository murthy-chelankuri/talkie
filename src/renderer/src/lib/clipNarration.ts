import type { TranscriptSegment } from '../api/projectClient'

// Playback resolves narration audio per clip (readNarrationAudioPaths keys a Map by
// timelineItemId), so a clip can only ever play one narration. The editor works in those terms:
// one narration per clip. Older projects that accumulated several segments on one clip are
// folded together here rather than having the extra text silently ignored.
export function segmentsForItem(segments: TranscriptSegment[], itemId: string): TranscriptSegment[] {
  return segments.filter((segment) => segment.timelineItemId === itemId)
}

export function narrationTextForItem(segments: TranscriptSegment[], itemId: string): string {
  return segmentsForItem(segments, itemId)
    .map((segment) => segment.text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n')
}

/**
 * The narration as the script view edits it: one timed line per beat.
 *
 * The timings are the words' own, so they belong in the text being edited rather than in some
 * control beside it — written back as `[12.3] ` prefixes, which is the same shape the drafter
 * produces and `parseBeats` reads. A take with no timings is shown as the prose it is; adding
 * a prefix to a line is all it takes to give it one.
 */
export function narrationScriptForItem(segments: TranscriptSegment[], itemId: string): string {
  const beats = segmentsForItem(segments, itemId)[0]?.beats
  if (!beats || beats.length === 0) return narrationTextForItem(segments, itemId)

  return beats.map((beat) => `[${beat.at.toFixed(1)}] ${beat.text}`).join('\n')
}

/** What the voice was before it could be chosen: `say -v Samantha` was hardcoded. */
export const LEGACY_VOICE = 'Samantha'

/** Kept in step with RECORDED_VOICE in the transcript schema. */
export const RECORDED_VOICE = 'your own voice'

/**
 * Whether this clip's narration was recorded in a voice other than the one now chosen.
 *
 * Changing the voice does not re-record anything, so without this the old audio would keep
 * playing in the preview with no sign of why.
 */
export function hasStaleVoice(segments: TranscriptSegment[], itemId: string, currentVoice: string): boolean {
  const segment = segmentsForItem(segments, itemId)[0]
  if (!segment?.audioFile || segment.status !== 'narrated') return false

  // A take in the user's own voice does not go out of date when the synthesised voice changes.
  if (segment.voice === RECORDED_VOICE) return false

  return voiceOf(segments, itemId) !== currentVoice
}

/**
 * Which voice read this clip. Narration recorded before the voice was choosable carries none,
 * but it is not unknown: that build could only ever have used Samantha.
 */
export function voiceOf(segments: TranscriptSegment[], itemId: string): string | undefined {
  const segment = segmentsForItem(segments, itemId)[0]
  if (!segment?.audioFile) return segment?.voice
  return segment.voice ?? LEGACY_VOICE
}

export type NarrationCommit =
  | { action: 'none' }
  | { action: 'create'; text: string }
  | { action: 'update'; id: string; text: string; removeIds: string[] }
  | { action: 'delete'; removeIds: string[] }

export function planNarrationCommit(
  segments: TranscriptSegment[],
  itemId: string,
  nextText: string
): NarrationCommit {
  const existing = segmentsForItem(segments, itemId)
  const text = nextText.trim()

  if (text === narrationTextForItem(segments, itemId)) return { action: 'none' }

  if (existing.length === 0) {
    return text.length === 0 ? { action: 'none' } : { action: 'create', text }
  }

  const [first, ...extras] = existing
  const removeIds = extras.map((segment) => segment.id)

  if (text.length === 0) {
    return { action: 'delete', removeIds: [first.id, ...removeIds] }
  }

  return { action: 'update', id: first.id, text, removeIds }
}
