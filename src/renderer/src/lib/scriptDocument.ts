import type { TranscriptSegment } from '../api/projectClient'

export interface ScriptChanges {
  updates: { id: string; text: string }[]
  additions: { text: string; timelineItemId: string }[]
  deletions: string[]
}

export function segmentsToScript(segments: TranscriptSegment[]): string {
  return segments.map((segment) => segment.text.trim()).join('\n\n')
}

export function parseScript(script: string): string[] {
  return script
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
}

// Paragraphs line up with segments by position: the first paragraph is the first segment, and
// so on. A paragraph past the end is a new segment, and a segment past the end of the script
// has been deleted. A new segment belongs to whatever clip the paragraph before it belongs to,
// since that is the part of the video the writer was just describing.
export function diffScript(
  segments: TranscriptSegment[],
  paragraphs: string[],
  fallbackTimelineItemId: string | null
): ScriptChanges {
  const changes: ScriptChanges = { updates: [], additions: [], deletions: [] }
  let lastTimelineItemId = fallbackTimelineItemId

  paragraphs.forEach((text, index) => {
    const existing = segments[index]
    if (existing) {
      lastTimelineItemId = existing.timelineItemId
      if (existing.text.trim() !== text) {
        changes.updates.push({ id: existing.id, text })
      }
      return
    }
    if (lastTimelineItemId) {
      changes.additions.push({ text, timelineItemId: lastTimelineItemId })
    }
  })

  changes.deletions = segments.slice(paragraphs.length).map((segment) => segment.id)
  return changes
}
