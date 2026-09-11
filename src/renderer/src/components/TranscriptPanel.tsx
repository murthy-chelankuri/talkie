import { useEffect, useMemo, useState } from 'react'
import { Mic } from 'lucide-react'
import { transcriptClient, type TranscriptSegment, type TimelineItem } from '../api/projectClient'
import { diffScript, parseScript, segmentsToScript } from '../lib/scriptDocument'
import { formatTimecode } from '../lib/timelineLayout'
import { FPS } from '../../../remotion/constants'
import { cn } from '../lib/cn'
import { Button } from './ui/Button'
import { Textarea } from './ui/Textarea'
import { Spinner } from './ui/Spinner'
import { ErrorBanner } from './ui/ErrorBanner'

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
  const savedScript = useMemo(() => segmentsToScript(segments), [segments])
  const [script, setScript] = useState(savedScript)
  const [saving, setSaving] = useState(false)
  const [narrating, setNarrating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Adopt changes that came from elsewhere (a narration, a new recording) unless the writer has
  // unsaved edits in front of them, which must not be pulled out from under them.
  useEffect(() => {
    setScript((current) => (current === savedScript ? current : current.trim() === '' ? savedScript : current))
  }, [savedScript])

  const dirty = script !== savedScript
  const pendingNarration = segments.filter((segment) => segment.status !== 'narrated')

  async function handleSave(): Promise<void> {
    setError(null)
    setSaving(true)
    try {
      const changes = diffScript(segments, parseScript(script), activeItemId ?? timeline[0]?.id ?? null)
      for (const update of changes.updates) {
        await transcriptClient.updateText(projectId, update.id, update.text)
      }
      for (const addition of changes.additions) {
        await transcriptClient.addSegment(projectId, addition)
      }
      for (const id of changes.deletions) {
        await transcriptClient.deleteSegment(projectId, id)
      }
      await onSegmentsChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleNarrateAll(): Promise<void> {
    setError(null)
    setNarrating(true)
    try {
      for (const segment of pendingNarration) {
        await transcriptClient.narrate(projectId, segment.id)
      }
      await onSegmentsChange()
      await onTimelineChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setNarrating(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {error && <ErrorBanner message={error} />}

      <ol className="flex flex-col gap-1">
        {segments.map((segment) => {
          const item = timeline.find((candidate) => candidate.id === segment.timelineItemId)
          const active = segment.timelineItemId === activeItemId
          return (
            <li key={segment.id}>
              <button
                type="button"
                onClick={() => item && onSeek(item.start)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs',
                  active
                    ? 'border-accent bg-accent text-accent-foreground'
                    : 'border-border bg-surface text-text-muted hover:bg-surface-hover'
                )}
              >
                <span className="shrink-0 tabular-nums">{formatTimecode((item?.start ?? 0) / FPS)}</span>
                {segment.status === 'narrated' && <Mic size={11} aria-hidden="true" className="shrink-0" />}
                <span className="truncate">{segment.text}</span>
              </button>
            </li>
          )
        })}
      </ol>

      <Textarea
        value={script}
        onChange={(event) => setScript(event.target.value)}
        placeholder="Write the narration here. Leave a blank line to start a new segment."
        aria-label="Script"
        className="min-h-40 flex-1 resize-none font-normal leading-relaxed"
      />

      <p className="text-xs text-text-muted">Blank line starts a new segment.</p>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving || !dirty}>
          {saving ? <Spinner size="sm" /> : 'Save'}
        </Button>
        <Button
          variant="secondary"
          onClick={handleNarrateAll}
          disabled={narrating || dirty || pendingNarration.length === 0}
        >
          {narrating ? <Spinner size="sm" /> : `Narrate all (${pendingNarration.length})`}
        </Button>
      </div>
    </div>
  )
}
