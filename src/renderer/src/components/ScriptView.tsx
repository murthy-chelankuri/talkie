import { useEffect, useRef, useState } from 'react'
import { AudioLines, Sparkles } from 'lucide-react'
import type { TimelineItem, TranscriptSegment } from '../api/projectClient'
import { narrationScriptForItem, segmentsForItem } from '../lib/clipNarration'
import { formatTimecode } from '../lib/timelineLayout'
import { FPS } from '../../../remotion/constants'
import { cn } from '../lib/cn'
import { ClipThumbnail } from './Timeline'
import { IconButton } from './ui/IconButton'
import { Spinner } from './ui/Spinner'

/**
 * The whole project's narration, read and written as one script.
 *
 * Narration used to be edited in a box the width of its own clip on the timeline — so the room
 * to write a paragraph was decided by how many seconds the clip ran, and below a certain width
 * the words were hidden altogether. Cutting sessions into scenes made that worse: one wide clip
 * became several narrow ones.
 *
 * Writing a script is a different act from operating a timeline. It is done top to bottom, in
 * one column wide enough to see a sentence in, and it wants the scenes either side visible —
 * most of what is wrong with narration is only wrong in context, where two scenes say the same
 * thing or the third does not follow from the second.
 *
 * The timings are part of the words, so they are edited as part of the words: a line beginning
 * `[12.3]` is spoken at that second of its clip. See narrationBeats.ts for what reads them back.
 */
export function ScriptView({
  timeline,
  segments,
  activeItemId,
  draftingItemId,
  narratingItemId,
  onSeek,
  onSelectItem,
  onCommit,
  onDraft,
  onNarrate
}: {
  timeline: TimelineItem[]
  segments: TranscriptSegment[]
  activeItemId: string | null
  draftingItemId: string | null
  narratingItemId: string | null
  onSeek: (frame: number) => void
  onSelectItem: (item: TimelineItem) => void
  onCommit: (item: TimelineItem, text: string) => void | Promise<void>
  onDraft: (item: TimelineItem) => void | Promise<void>
  onNarrate: (item: TimelineItem) => void | Promise<void>
}): JSX.Element {
  if (timeline.length === 0) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-text-muted">
        Record or add something, and its narration will be written here.
      </p>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <ol className="mx-auto flex max-w-4xl flex-col gap-1 p-3">
        {timeline.map((item, index) => (
          <ScriptRow
            key={item.id}
            item={item}
            index={index}
            segments={segments}
            active={item.id === activeItemId}
            drafting={draftingItemId === item.id}
            narrating={narratingItemId === item.id}
            onSeek={onSeek}
            onSelectItem={onSelectItem}
            onCommit={onCommit}
            onDraft={onDraft}
            onNarrate={onNarrate}
          />
        ))}
      </ol>
    </div>
  )
}

function ScriptRow({
  item,
  index,
  segments,
  active,
  drafting,
  narrating,
  onSeek,
  onSelectItem,
  onCommit,
  onDraft,
  onNarrate
}: {
  item: TimelineItem
  index: number
  segments: TranscriptSegment[]
  active: boolean
  drafting: boolean
  narrating: boolean
  onSeek: (frame: number) => void
  onSelectItem: (item: TimelineItem) => void
  onCommit: (item: TimelineItem, text: string) => void | Promise<void>
  onDraft: (item: TimelineItem) => void | Promise<void>
  onNarrate: (item: TimelineItem) => void | Promise<void>
}): JSX.Element {
  const saved = narrationScriptForItem(segments, item.id)
  const [draft, setDraft] = useState(saved)
  const lastSavedRef = useRef(saved)

  // Take in changes made elsewhere — a draft arriving, an undo — without ever discarding what
  // is being typed. Same rule as the timeline's box, for the same reason.
  useEffect(() => {
    if (saved === lastSavedRef.current) return
    setDraft((current) => (current === lastSavedRef.current ? saved : current))
    lastSavedRef.current = saved
  }, [saved])

  const segment = segmentsForItem(segments, item.id)[0]
  const seconds = item.duration / FPS
  const label = `Narration for clip ${index + 1}`

  return (
    <li
      className={cn(
        'flex gap-3 rounded-md border p-2',
        active ? 'border-accent bg-paper' : 'border-transparent hover:border-border'
      )}
    >
      <button
        type="button"
        aria-label={`Play from clip ${index + 1}`}
        onClick={() => {
          onSeek(item.start)
          onSelectItem(item)
        }}
        className="flex w-24 shrink-0 cursor-pointer flex-col gap-1 border-0 bg-transparent p-0 text-left"
      >
        <span className="flex items-baseline gap-1.5 text-[11px] text-text-muted">
          <span className="font-medium text-text">{index + 1}</span>
          <span className="font-mono tabular-nums">{formatTimecode(item.start / FPS)}</span>
        </span>
        <span className="aspect-video w-full overflow-hidden rounded border border-border">
          <ClipThumbnail item={item} />
        </span>
        <span className="text-[10px] text-text-muted">{seconds.toFixed(1)}s</span>
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <textarea
          value={draft}
          aria-label={label}
          placeholder="Nothing said over this one yet. Write it, or draft it with the spark."
          rows={Math.max(3, draft.split('\n').length + 1)}
          data-clip-seconds={seconds.toFixed(2)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onCommit(item, draft)}
          onFocus={() => onSelectItem(item)}
          className="w-full resize-y rounded border border-border bg-surface px-2.5 py-2 font-serif text-[14px] leading-relaxed text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
        <div className="flex items-center gap-2 text-[10px] text-text-muted">
          <span>{statusOf(segment)}</span>
          <span className="ml-auto flex items-center gap-1">
            <IconButton
              aria-label={drafting ? `Drafting ${label}` : `Draft ${label}`}
              className="h-5 w-5 text-text-muted hover:text-accent"
              disabled={drafting || narrating}
              onClick={() => onDraft(item)}
            >
              {drafting ? <Spinner size="sm" /> : <Sparkles size={12} />}
            </IconButton>
            <IconButton
              aria-label={narrating ? `Narrating ${label}` : `Narrate ${label}`}
              className="h-5 w-5 text-text-muted hover:text-accent"
              disabled={narrating || drafting || !draft.trim() || draft !== saved}
              onClick={() => onNarrate(item)}
            >
              {narrating ? <Spinner size="sm" /> : <AudioLines size={12} />}
            </IconButton>
          </span>
        </div>
      </div>
    </li>
  )
}

/** Where this clip's narration has got to, in the fewest words that say it. */
function statusOf(segment: TranscriptSegment | undefined): string {
  if (!segment || !segment.text.trim()) return 'No narration'
  const timing = segment.beats?.length ? `${segment.beats.length} timed lines` : 'untimed'
  if (segment.status === 'narrated') return `Voiced · ${timing}`
  return segment.status === 'draft' ? `Drafted · ${timing}` : `Written · ${timing}`
}
