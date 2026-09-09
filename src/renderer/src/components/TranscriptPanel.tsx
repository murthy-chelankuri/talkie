import { useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import { transcriptClient, type TranscriptSegment, type TimelineItem } from '../api/projectClient'
import { Card } from './ui/Card'
import { Textarea } from './ui/Textarea'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Spinner } from './ui/Spinner'
import { ErrorBanner } from './ui/ErrorBanner'

export function TranscriptPanel({
  projectId,
  timeline,
  onTimelineChange
}: {
  projectId: string
  timeline: TimelineItem[]
  onTimelineChange: () => void | Promise<void>
}): JSX.Element {
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [newText, setNewText] = useState('')
  const [newItemId, setNewItemId] = useState('')
  const [narratingId, setNarratingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    transcriptClient.read(projectId).then(setSegments)
  }, [projectId])

  async function handleAdd(): Promise<void> {
    if (!newText.trim() || !newItemId) return
    setError(null)
    setAdding(true)
    try {
      await transcriptClient.addSegment(projectId, { text: newText.trim(), timelineItemId: newItemId })
      setNewText('')
      setSegments(await transcriptClient.read(projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
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
      await onTimelineChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setNarratingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} />}
      {segments.map((segment) => (
        <Card key={segment.id} className="flex flex-col gap-2">
          <Textarea
            value={segment.text}
            onChange={(e) => handleLocalTextChange(segment.id, e.target.value)}
            onBlur={(e) => handleTextBlur(segment.id, e.target.value)}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">{segment.status}</span>
            <IconButton
              aria-label={narratingId === segment.id ? 'Narrating' : 'Narrate'}
              onClick={() => handleNarrate(segment.id)}
              disabled={narratingId === segment.id}
            >
              {narratingId === segment.id ? <Spinner size="sm" /> : <Mic size={16} />}
            </IconButton>
          </div>
        </Card>
      ))}
      <Card className="flex flex-col gap-2">
        <select
          value={newItemId}
          onChange={(e) => setNewItemId(e.target.value)}
          disabled={adding}
          className="h-9 rounded-md border border-border bg-bg px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
        >
          <option value="">Select timeline item…</option>
          {timeline.map((item) => (
            <option key={item.id} value={item.id}>
              {item.kind} ({item.id.slice(0, 8)})
            </option>
          ))}
        </select>
        <Textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="New segment text"
          disabled={adding}
        />
        <Button onClick={handleAdd} disabled={adding || !newText.trim() || !newItemId}>
          Add Segment
        </Button>
      </Card>
    </div>
  )
}
