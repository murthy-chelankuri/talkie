import { useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import type { TimelineItem, TranscriptSegment } from '../api/projectClient'
import { narrationTextForItem, segmentsForItem } from '../lib/clipNarration'
import { formatTimecode } from '../lib/timelineLayout'
import { FPS } from '../../../remotion/constants'
import { cn } from '../lib/cn'
import { IconButton } from './ui/IconButton'
import { Spinner } from './ui/Spinner'

export function ClipNarrationBox({
  item,
  segments,
  active,
  narrating,
  onCommit,
  onNarrate
}: {
  item: TimelineItem
  segments: TranscriptSegment[]
  active: boolean
  narrating: boolean
  onCommit: (item: TimelineItem, text: string) => void | Promise<void>
  onNarrate: (item: TimelineItem) => void | Promise<void>
}): JSX.Element {
  const savedText = narrationTextForItem(segments, item.id)
  const [draft, setDraft] = useState(savedText)

  // Take in changes made elsewhere (a narration finishing, a clip being split) without
  // discarding whatever is being typed right now.
  useEffect(() => {
    setDraft((current) => (current === savedText ? current : current.trim() === '' ? savedText : current))
  }, [savedText])

  const narrated = segmentsForItem(segments, item.id)[0]?.status === 'narrated'
  const label = `Narration for ${item.kind} at ${formatTimecode(item.start / FPS)}`

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-md border bg-surface',
        active ? 'border-accent' : 'border-border'
      )}
    >
      <div className="flex items-center gap-1 border-b border-border px-1 py-0.5">
        <span
          className={cn('truncate text-[10px]', narrated ? 'text-text-muted' : 'text-danger')}
          title={narrated ? 'narrated' : 'not narrated'}
        >
          {narrated ? 'narrated' : 'not narrated'}
        </span>
        <IconButton
          aria-label={narrating ? `Narrating ${label}` : `Narrate ${label}`}
          className="ml-auto h-5 w-5 shrink-0"
          disabled={narrating || !draft.trim() || draft !== savedText}
          onClick={() => onNarrate(item)}
        >
          {narrating ? <Spinner size="sm" /> : <Mic size={12} />}
        </IconButton>
      </div>
      <textarea
        value={draft}
        aria-label={label}
        placeholder="Narration…"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(item, draft)}
        className="min-h-0 flex-1 resize-none border-0 bg-transparent px-1.5 py-1 text-xs leading-snug text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
      />
    </div>
  )
}
