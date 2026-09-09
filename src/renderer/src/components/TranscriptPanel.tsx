import { useEffect, useState } from 'react'
import { transcriptClient, type TranscriptSegment } from '../api/projectClient'
import type { TimelineItem } from '../api/projectClient'

export function TranscriptPanel({
  projectId,
  timeline
}: {
  projectId: string
  timeline: TimelineItem[]
}): JSX.Element {
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [newText, setNewText] = useState('')
  const [newItemId, setNewItemId] = useState('')
  const [narratingId, setNarratingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    transcriptClient.read(projectId).then(setSegments)
  }, [projectId])

  async function handleAdd(): Promise<void> {
    if (!newText.trim() || !newItemId) return
    setError(null)
    try {
      await transcriptClient.addSegment(projectId, { text: newText.trim(), timelineItemId: newItemId })
      setNewText('')
      setSegments(await transcriptClient.read(projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleLocalTextChange(segmentId: string, text: string): void {
    setSegments((prev) => prev.map((s) => (s.id === segmentId ? { ...s, text } : s)))
  }

  async function handleTextBlur(segmentId: string, text: string): Promise<void> {
    setError(null)
    try {
      await transcriptClient.updateText(projectId, segmentId, text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleNarrate(segmentId: string): Promise<void> {
    setNarratingId(segmentId)
    setError(null)
    try {
      const updated = await transcriptClient.narrate(projectId, segmentId)
      setSegments((prev) => prev.map((s) => (s.id === segmentId ? updated : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setNarratingId(null)
    }
  }

  return (
    <div>
      <p>Transcript</p>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {segments.map((segment) => (
        <div key={segment.id}>
          <textarea
            value={segment.text}
            onChange={(e) => handleLocalTextChange(segment.id, e.target.value)}
            onBlur={(e) => handleTextBlur(segment.id, e.target.value)}
          />
          <span>{segment.status}</span>
          <button onClick={() => handleNarrate(segment.id)} disabled={narratingId === segment.id}>
            {narratingId === segment.id ? 'Narrating…' : 'Narrate'}
          </button>
        </div>
      ))}
      <div>
        <select value={newItemId} onChange={(e) => setNewItemId(e.target.value)}>
          <option value="">Select timeline item…</option>
          {timeline.map((item) => (
            <option key={item.id} value={item.id}>
              {item.kind} ({item.id.slice(0, 8)})
            </option>
          ))}
        </select>
        <textarea value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="New segment text" />
        <button onClick={handleAdd}>Add Segment</button>
      </div>
    </div>
  )
}
