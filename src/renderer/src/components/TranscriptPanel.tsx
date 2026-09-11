import { useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'
import { transcriptClient, type TranscriptSegment, type TimelineItem } from '../api/projectClient'
import { narrationTextForItem, planNarrationCommit, segmentsForItem } from '../lib/clipNarration'
import { formatTimecode } from '../lib/timelineLayout'
import { FPS } from '../../../remotion/constants'
import { cn } from '../lib/cn'
import { Button } from './ui/Button'
import { Textarea } from './ui/Textarea'
import { IconButton } from './ui/IconButton'
import { Spinner } from './ui/Spinner'
import { EmptyState } from './ui/EmptyState'
import { ErrorBanner } from './ui/ErrorBanner'

function ClipNarration({
  item,
  segments,
  active,
  narrating,
  onSeek,
  onCommit,
  onNarrate
}: {
  item: TimelineItem
  segments: TranscriptSegment[]
  active: boolean
  narrating: boolean
  onSeek: (frame: number) => void
  onCommit: (item: TimelineItem, text: string) => void | Promise<void>
  onNarrate: (item: TimelineItem) => void | Promise<void>
}): JSX.Element {
  const savedText = narrationTextForItem(segments, item.id)
  const [draft, setDraft] = useState(savedText)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Grow with the narration so nothing is hidden behind a scrollbar inside a small box.
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [draft])

  // Take in changes made elsewhere (a narration finishing, a clip being split) without
  // discarding whatever is being typed right now.
  useEffect(() => {
    setDraft((current) => (current === savedText ? current : current.trim() === '' ? savedText : current))
  }, [savedText])

  const status = segmentsForItem(segments, item.id)[0]?.status
  const narrated = status === 'narrated'

  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-md border p-2',
        active ? 'border-accent bg-surface' : 'border-border bg-surface'
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSeek(item.start)}
          className={cn(
            'flex items-center gap-2 rounded px-1 py-0 text-xs',
            active ? 'text-accent' : 'text-text-muted hover:text-text'
          )}
        >
          <span className="tabular-nums">{formatTimecode(item.start / FPS)}</span>
          <span>{item.kind}</span>
        </button>
        <span className="ml-auto flex items-center gap-1 text-xs text-text-muted">
          {narrated ? 'narrated' : draft.trim() ? 'not narrated' : 'no narration'}
          <IconButton
            aria-label={narrating ? `Narrating ${item.kind}` : `Narrate ${item.kind}`}
            disabled={narrating || !draft.trim() || draft !== savedText}
            onClick={() => onNarrate(item)}
          >
            {narrating ? <Spinner size="sm" /> : <Mic size={14} />}
          </IconButton>
        </span>
      </div>
      <Textarea
        ref={textareaRef}
        value={draft}
        aria-label={`Narration for ${item.kind} at ${formatTimecode(item.start / FPS)}`}
        placeholder="Say something about this clip…"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(item, draft)}
        className="min-h-16 resize-none leading-relaxed"
      />
    </li>
  )
}

export function TranscriptPanel({
  projectId,
  timeline,
  segments,
  activeItemId,
  onSegmentsChange,
  onTimelineChange,
  onSeek
}: {
  projectId: string
  timeline: TimelineItem[]
  segments: TranscriptSegment[]
  activeItemId: string | null
  onSegmentsChange: () => void | Promise<void>
  onTimelineChange: () => void | Promise<void>
  onSeek: (frame: number) => void
}): JSX.Element {
  const [narratingItemId, setNarratingItemId] = useState<string | null>(null)
  const [narratingAll, setNarratingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needingNarration = timeline.filter((item) => {
    const segment = segmentsForItem(segments, item.id)[0]
    return segment && segment.status !== 'narrated'
  })

  async function handleCommit(item: TimelineItem, text: string): Promise<void> {
    const plan = planNarrationCommit(segments, item.id, text)
    if (plan.action === 'none') return

    setError(null)
    try {
      if (plan.action === 'create') {
        await transcriptClient.addSegment(projectId, { text: plan.text, timelineItemId: item.id })
      } else if (plan.action === 'update') {
        await transcriptClient.updateText(projectId, plan.id, plan.text)
        for (const id of plan.removeIds) {
          await transcriptClient.deleteSegment(projectId, id)
        }
      } else {
        for (const id of plan.removeIds) {
          await transcriptClient.deleteSegment(projectId, id)
        }
      }
      await onSegmentsChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function narrateItem(item: TimelineItem): Promise<void> {
    const segment = segmentsForItem(segments, item.id)[0]
    if (!segment) return
    await transcriptClient.narrate(projectId, segment.id)
  }

  async function handleNarrate(item: TimelineItem): Promise<void> {
    setError(null)
    setNarratingItemId(item.id)
    try {
      await narrateItem(item)
      await onSegmentsChange()
      await onTimelineChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setNarratingItemId(null)
    }
  }

  async function handleNarrateAll(): Promise<void> {
    setError(null)
    setNarratingAll(true)
    try {
      for (const item of needingNarration) {
        setNarratingItemId(item.id)
        await narrateItem(item)
      }
      await onSegmentsChange()
      await onTimelineChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setNarratingItemId(null)
      setNarratingAll(false)
    }
  }

  if (timeline.length === 0) {
    return (
      <EmptyState
        title="Nothing to narrate yet"
        description="Record a session or import an image, then write its narration here."
      />
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {error && <ErrorBanner message={error} />}

      <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {timeline.map((item) => (
          <ClipNarration
            key={item.id}
            item={item}
            segments={segments}
            active={item.id === activeItemId}
            narrating={narratingItemId === item.id}
            onSeek={onSeek}
            onCommit={handleCommit}
            onNarrate={handleNarrate}
          />
        ))}
      </ol>

      <p className="text-xs text-text-muted">
        One narration per clip, in order. Split a clip on the timeline to narrate part of it.
      </p>

      <Button
        variant="secondary"
        onClick={handleNarrateAll}
        disabled={narratingAll || needingNarration.length === 0}
      >
        {narratingAll ? <Spinner size="sm" /> : `Narrate all (${needingNarration.length})`}
      </Button>
    </div>
  )
}
