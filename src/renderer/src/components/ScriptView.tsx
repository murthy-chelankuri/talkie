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
 * Narration used to be edited in a box the width of its own clip on the timeline, so the room
 * to write a paragraph was decided by how many seconds that clip ran. Writing is done top to
 * bottom, in one column wide enough to see a sentence in, and it wants the scenes either side
 * visible — most of what is wrong with narration is only wrong in context.
 *
 * It is paper, because the app has already decided that is what writing is made of: "the
 * narration row is a warmer surface, because writing a script is a different act from operating
 * a timeline and should feel like one". The first pass at this screen was built out of the same
 * cool chrome as the timeline and bordered every scene like a form field, which fought both the
 * material and the act.
 *
 * So it is one sheet rather than a stack of cards. Scenes are divisions down the margin — a
 * number, where it falls, how long it runs — and the words themselves are the only loud thing
 * on it. Nothing is boxed; a hairline separates one scene from the next and the margin marks
 * which one is playing.
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
      <div className="flex h-full items-center justify-center bg-paper">
        <p className="max-w-sm px-6 text-center font-serif text-[15px] leading-relaxed text-text-muted">
          Record a session or add a slide, and what you say over it is written here.
        </p>
      </div>
    )
  }

  const runs = timeline.reduce((total, item) => total + item.duration, 0)

  return (
    <div className="h-full overflow-y-auto bg-paper">
      <div className="mx-auto max-w-3xl px-6 py-5">
        {/* What this sheet covers, said once at the top rather than repeated down the margin. */}
        <p className="mb-5 font-serif text-[13px] italic text-text-muted">
          {timeline.length} {timeline.length === 1 ? 'scene' : 'scenes'} over {formatTimecode(runs / FPS)}
        </p>

        {timeline.map((item, index) => (
          <Scene
            key={item.id}
            item={item}
            index={index}
            first={index === 0}
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
      </div>
    </div>
  )
}

function Scene({
  item,
  index,
  first,
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
  first: boolean
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
  const label = `Narration for scene ${index + 1}`

  return (
    <section
      className={cn(
        'group grid grid-cols-[5.5rem_1fr] gap-5 py-5',
        !first && 'border-t border-paper-border'
      )}
    >
      <button
        type="button"
        aria-label={`Play from scene ${index + 1}`}
        onClick={() => {
          onSeek(item.start)
          onSelectItem(item)
        }}
        className={cn(
          // The margin, marked rather than boxed: a rule beside the scene that is playing says
          // where you are without drawing another rectangle on a page full of them.
          'flex cursor-pointer flex-col items-start gap-1.5 border-0 border-l-2 bg-transparent py-0 pl-3 pr-0 text-left',
          active ? 'border-l-accent' : 'border-l-transparent'
        )}
      >
        <span className={cn('font-serif text-[17px] leading-none', active ? 'text-accent' : 'text-text')}>
          {index + 1}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-text-muted">
          {formatTimecode(item.start / FPS)}
        </span>
        <span className="mt-0.5 w-full overflow-hidden rounded-sm opacity-70 transition-opacity group-hover:opacity-100">
          <span className="block aspect-video w-full">
            <ClipThumbnail item={item} />
          </span>
        </span>
        <span className="text-[10px] text-text-muted">{seconds.toFixed(1)}s</span>
      </button>

      <div className="min-w-0">
        {/* Borderless and transparent: this is the sheet, not a field sitting on it. The words
            are the only thing on the page meant to be loud, so they get the serif at a size
            worth reading and a column short enough to read across without losing the line. */}
        <textarea
          value={draft}
          aria-label={label}
          placeholder="Nothing said over this one yet."
          rows={Math.max(2, draft.split('\n').length)}
          data-clip-seconds={seconds.toFixed(2)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onCommit(item, draft)}
          onFocus={() => onSelectItem(item)}
          className="w-full max-w-[62ch] resize-none border-0 bg-transparent p-0 font-serif text-[15px] leading-[1.65] text-paper-text placeholder:italic placeholder:text-text-muted focus:outline-none"
        />
        <p className="mt-2 flex h-5 items-center gap-2 text-[10px] text-text-muted">
          <span>{statusOf(segment)}</span>
          {/* Held back until the scene is wanted: a page of writing does not need two buttons
              beside every paragraph of it. */}
          <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
        </p>
      </div>
    </section>
  )
}

/** Where this scene's narration has got to, in the fewest words that say it. */
function statusOf(segment: TranscriptSegment | undefined): string {
  if (!segment || !segment.text.trim()) return 'Nothing written'

  const beats = segment.beats?.length ?? 0
  const timing = beats > 0 ? `timed to ${beats} ${beats === 1 ? 'moment' : 'moments'}` : 'read straight through'
  if (segment.status === 'narrated') return `Voiced, ${timing}`
  return segment.status === 'draft' ? `Drafted, ${timing}` : `Written, ${timing}`
}
