import { useState } from 'react'
import { Mic } from 'lucide-react'
import { transcriptClient, type TranscriptSegment, type TimelineItem } from '../api/projectClient'
import { Card } from './ui/Card'
import { Textarea } from './ui/Textarea'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Spinner } from './ui/Spinner'
import { EmptyState } from './ui/EmptyState'
import { ErrorBanner } from './ui/ErrorBanner'

export function TranscriptPanel({
  projectId,
  timeline,
  segments,
  selectedSegmentId,
  onSegmentsChange,
  onSelectSegment,
  onTimelineChange
}: {
  projectId: string
  timeline: TimelineItem[]
  segments: TranscriptSegment[]
  selectedSegmentId: string | null
  onSegmentsChange: () => void | Promise<void>
  onSelectSegment: (segmentId: string) => void
  onTimelineChange: () => void | Promise<void>
}): JSX.Element {
  const [newText, setNewText] = useState('')
  const [newItemId, setNewItemId] = useState('')
  const [narrating, setNarrating] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draftText, setDraftText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = segments.find((segment) => segment.id === selectedSegmentId) ?? null

  async function handleAdd(): Promise<void> {
    if (!newText.trim() || !newItemId) return
    setError(null)
    setAdding(true)
    try {
      const added = await transcriptClient.addSegment(projectId, {
        text: newText.trim(),
        timelineItemId: newItemId
      })
      setNewText('')
      await onSegmentsChange()
      onSelectSegment(added.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  async function handleTextBlur(segmentId: string, text: string): Promise<void> {
    setError(null)
    try {
      await transcriptClient.updateText(projectId, segmentId, text)
      setDraftText(null)
      await onSegmentsChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleNarrate(segmentId: string): Promise<void> {
    setNarrating(true)
    setError(null)
    try {
      await transcriptClient.narrate(projectId, segmentId)
      await onSegmentsChange()
      await onTimelineChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setNarrating(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} />}

      {selected ? (
        <Card className="flex flex-col gap-2">
          <Textarea
            value={draftText ?? selected.text}
            onChange={(event) => setDraftText(event.target.value)}
            onBlur={(event) => handleTextBlur(selected.id, event.target.value)}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">{selected.status}</span>
            <IconButton
              aria-label={narrating ? 'Narrating' : 'Narrate'}
              onClick={() => handleNarrate(selected.id)}
              disabled={narrating}
            >
              {narrating ? <Spinner size="sm" /> : <Mic size={16} />}
            </IconButton>
          </div>
        </Card>
      ) : (
        <EmptyState
          title="No segment selected"
          description="Pick a block on the transcript track to edit it, or add one below."
        />
      )}

      <Card className="flex flex-col gap-2">
        <select
          value={newItemId}
          onChange={(event) => setNewItemId(event.target.value)}
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
          onChange={(event) => setNewText(event.target.value)}
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
