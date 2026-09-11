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
