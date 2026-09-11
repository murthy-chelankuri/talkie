import { useEffect, useRef, useState } from 'react'
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
  const lastSavedRef = useRef(savedText)

  // Take in changes made elsewhere — a narration finishing, an undo — while never discarding
  // what is being typed. Untouched means the draft still matches the text last seen as saved.
  useEffect(() => {
    if (savedText === lastSavedRef.current) return
    setDraft((current) => (current === lastSavedRef.current ? savedText : current))
    lastSavedRef.current = savedText
  }, [savedText])

  const narrated = segmentsForItem(segments, item.id)[0]?.status === 'narrated'
  const label = `Narration for ${item.kind} at ${formatTimecode(item.start / FPS)}`

  return (
    <div
      className={cn(
        // Warm paper against the cool chrome above: writing a script is a different act from
        // operating the timeline, so the surface says so.
        'flex h-full flex-col overflow-hidden rounded-md border bg-paper',
        active ? 'border-accent' : 'border-paper-border'
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-paper-border px-1.5 py-1">
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            narrated ? 'bg-success' : 'border border-text-muted'
          )}
          aria-hidden="true"
        />
        <span className="truncate text-[10px] text-text-muted">
          {narrated ? 'Voiced' : 'Needs voice'}
        </span>
        <IconButton
          aria-label={narrating ? `Narrating ${label}` : `Narrate ${label}`}
          className="ml-auto h-5 w-5 shrink-0 text-text-muted hover:text-accent"
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
        className="min-h-0 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 font-serif text-[13px] leading-relaxed text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
      />
    </div>
  )
}
