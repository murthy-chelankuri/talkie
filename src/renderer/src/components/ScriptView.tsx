import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { PlayerRef } from '@remotion/player'
import { AudioLines, Maximize2, Mic, Minimize2, Play, Sparkles, Square, TriangleAlert } from 'lucide-react'
import type { TimelineItem, TranscriptSegment } from '../api/projectClient'
import { narrationScriptForItem, segmentsForItem } from '../lib/clipNarration'
import { narrationFit, scriptParts, type NarrationFit } from '../lib/narrationFit'
import { KIND_NAMES } from '../lib/clipKinds'
import { formatTimecode } from '../lib/timelineLayout'
import { useTakeSeconds } from '../hooks/useTakeSeconds'
import { FPS } from '../../../remotion/constants'
import { cn } from '../lib/cn'
import { ClipThumbnail } from './Timeline'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'

/** Long enough to finish a thought, short enough that leaving the scene never finds it unsaved. */
const AUTOSAVE_MS = 900

/**
 * The whole project's narration, read and written as one script.
 *
 * Narration used to be edited in a box the width of its own clip on the timeline, so the room
 * to write a paragraph was decided by how many seconds that clip ran. Writing is done top to
 * bottom, in one column wide enough to see a sentence in, and it wants the scenes either side
 * visible — most of what is wrong with narration is only wrong in context.
 *
 * It is paper, because writing a script is a different act from operating a timeline. One sheet
 * rather than a stack of cards: each scene is headed by what is on screen and where it falls,
 * and the words under it are the loudest thing on the page.
 *
 * What a writer needs to know beside the words is said beside them, in words: whether they fit
 * the clip, whether they are saved, and what can be done next. The first version kept all of
 * that in a cramped margin and behind hover, and read as a form with the labels missing.
 */
export function ScriptView({
  timeline,
  segments,
  activeItemId,
  draftingItemId,
  narratingItemId,
  recordingItemId = null,
  playerRef,
  onSeek,
  onSelectItem,
  onCommit,
  onDraft,
  onNarrate,
  onRecord,
  onStopRecording
}: {
  timeline: TimelineItem[]
  segments: TranscriptSegment[]
  activeItemId: string | null
  draftingItemId: string | null
  narratingItemId: string | null
  /** The scene whose narration is being recorded in the user's own voice, if any. */
  recordingItemId?: string | null
  /** The preview, followed so the scene being played stays on the page. */
  playerRef?: RefObject<PlayerRef | null>
  onSeek: (frame: number) => void
  onSelectItem: (item: TimelineItem) => void
  onCommit: (item: TimelineItem, text: string) => void | Promise<void>
  onDraft: (item: TimelineItem) => void | Promise<void>
  onNarrate: (item: TimelineItem) => void | Promise<void>
  onRecord?: (item: TimelineItem) => void | Promise<void>
  onStopRecording?: () => void | Promise<void>
}): JSX.Element {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  // Counted from what each scene says rather than worked out again here: a scene trusts its take
  // over the estimate, and the count at the top once disagreed with every scene under it.
  const [longIds, setLongIds] = useState<ReadonlySet<string>>(new Set())
  // One scene set large, for working on it alone or reading it aloud while recording. One at a
  // time: the point is that it stands out from the rest.
  const [enlargedId, setEnlargedId] = useState<string | null>(null)
  const reportFit = useCallback((id: string, long: boolean): void => {
    setLongIds((current) => {
      if (current.has(id) === long) return current
      const next = new Set(current)
      if (long) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const playingId = usePlayingItem(playerRef, timeline, activeItemId)

  // Follow the playhead down the page — but never pull the page out from under someone typing,
  // which is the one time they have said where they want to be.
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet || !playingId) return
    const active = document.activeElement
    if (active instanceof HTMLTextAreaElement && sheet.contains(active)) return
    const scene = Array.from(sheet.querySelectorAll('[data-scene-id]')).find((el) => el.getAttribute('data-scene-id') === playingId)
    scene?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [playingId])

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
  const long = timeline.filter((item) => longIds.has(item.id)).length

  return (
    <div ref={sheetRef} className="h-full overflow-y-auto bg-paper">
      <div className={cn('mx-auto px-8 pb-10 pt-5', enlargedId ? 'max-w-5xl' : 'max-w-3xl')}>
        {/* What this sheet covers, said once at the top rather than repeated down the margin. */}
        <p className="mb-2 flex items-center gap-3 font-serif text-[13px] italic text-text-muted">
          <span>
            {timeline.length} {timeline.length === 1 ? 'scene' : 'scenes'} over {formatTimecode(runs / FPS)}
          </span>
          {long > 0 && (
            <span className="flex items-center gap-1 font-sans text-[11px] not-italic text-warning">
              <TriangleAlert size={12} aria-hidden="true" />
              {long} {long === 1 ? 'scene has' : 'scenes have'} more words than time
            </span>
          )}
        </p>

        {timeline.map((item, index) => (
          <Scene
            key={item.id}
            item={item}
            index={index}
            first={index === 0}
            segments={segments}
            playing={item.id === playingId}
            drafting={draftingItemId === item.id}
            narrating={narratingItemId === item.id}
            recording={recordingItemId === item.id}
            recordingElsewhere={recordingItemId !== null && recordingItemId !== item.id}
            enlarged={enlargedId === item.id}
            onToggleEnlarged={() => setEnlargedId((current) => (current === item.id ? null : item.id))}
            onFit={reportFit}
            onSeek={onSeek}
            onSelectItem={onSelectItem}
            onCommit={onCommit}
            onDraft={onDraft}
            onNarrate={onNarrate}
            onRecord={onRecord}
            onStopRecording={onStopRecording}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Which scene the preview is on. The timeline reports this while it is mounted; the script is
 * shown instead of it, so it listens to the player itself.
 */
function usePlayingItem(
  playerRef: RefObject<PlayerRef | null> | undefined,
  timeline: TimelineItem[],
  fallback: string | null
): string | null {
  const at = (frame: number): string | null =>
    timeline.find((item) => frame >= item.start && frame < item.start + item.duration)?.id ?? null
  // Read off the player when the script appears, not only when it next moves: the script is
  // mounted afresh each time it is switched to, often with the playhead well into the video.
  const [playingId, setPlayingId] = useState<string | null>(() => {
    const frame = playerRef?.current?.getCurrentFrame()
    return frame == null ? fallback : at(frame)
  })

  useEffect(() => {
    const player = playerRef?.current
    if (!player) return
    const onFrame = ({ detail }: { detail: { frame: number } }): void => setPlayingId(at(detail.frame))
    player.addEventListener('frameupdate', onFrame)
    return () => player.removeEventListener('frameupdate', onFrame)
    // `at` reads only the timeline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerRef, timeline])

  return playingId
}

function Scene({
  item,
  index,
  first,
  segments,
  playing,
  drafting,
  narrating,
  recording,
  recordingElsewhere,
  enlarged,
  onToggleEnlarged,
  onFit,
  onSeek,
  onSelectItem,
  onCommit,
  onDraft,
  onNarrate,
  onRecord,
  onStopRecording
}: {
  item: TimelineItem
  index: number
  first: boolean
  segments: TranscriptSegment[]
  playing: boolean
  drafting: boolean
  narrating: boolean
  recording: boolean
  recordingElsewhere: boolean
  enlarged: boolean
  onToggleEnlarged: () => void
  onFit: (id: string, long: boolean) => void
  onSeek: (frame: number) => void
  onSelectItem: (item: TimelineItem) => void
  onCommit: (item: TimelineItem, text: string) => void | Promise<void>
  onDraft: (item: TimelineItem) => void | Promise<void>
  onNarrate: (item: TimelineItem) => void | Promise<void>
  onRecord?: (item: TimelineItem) => void | Promise<void>
  onStopRecording?: () => void | Promise<void>
}): JSX.Element {
  const saved = narrationScriptForItem(segments, item.id)
  const [draft, setDraft] = useState(saved)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const draftRef = useRef(draft)
  draftRef.current = draft
  const lastSavedRef = useRef(saved)
  // What was last handed to onCommit. Autosave and leaving the box can both fire for the same
  // words, and committing them twice before the first has come back would create two segments.
  const sentRef = useRef(saved)

  // Take in changes made elsewhere — a draft arriving, an undo — without ever discarding what
  // is being typed. Words that were just saved count as not being typed: the store hands them
  // back tidied (`[2]` becomes `[2.0]`), and keeping the untidy copy would leave the scene
  // looking unsaved and Voice switched off for good.
  useEffect(() => {
    if (saved === lastSavedRef.current) return
    const current = draftRef.current
    if (current === lastSavedRef.current || current === sentRef.current) {
      setDraft(saved)
      sentRef.current = saved
    }
    lastSavedRef.current = saved
  }, [saved])

  async function commit(text: string): Promise<void> {
    if (text === sentRef.current) return
    sentRef.current = text
    setSaving('saving')
    await onCommit(item, text)
    setSaving('saved')
  }

  // Saved while typing, not only on leaving the box: a script is written over minutes, and
  // pressing Play or switching tab should never be what decides whether the words were kept.
  // An empty box waits for the person to leave it — clearing a scene to retype it would
  // otherwise delete its take in the pause before the first new word.
  useEffect(() => {
    if (draft === sentRef.current || !draft.trim()) return
    const timer = setTimeout(() => void commit(draft), AUTOSAVE_MS)
    return () => clearTimeout(timer)
    // commit closes over the item and onCommit, which are stable for as long as the draft is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  useEffect(() => {
    if (saving !== 'saved') return
    const timer = setTimeout(() => setSaving('idle'), 2000)
    return () => clearTimeout(timer)
  }, [saving])

  const segment = segmentsForItem(segments, item.id)[0]
  const audioUrl = (item.data as { audioUrl?: string } | null | undefined)?.audioUrl
  // The take only speaks for the words while they are the words it read.
  const takeSeconds = useTakeSeconds(segment?.status === 'narrated' && draft === saved ? audioUrl : undefined)
  const fit = draft.trim() ? narrationFit(draft, item.duration, takeSeconds) : null
  const label = `Narration for scene ${index + 1}`
  const long = fit?.long ?? false

  useEffect(() => {
    onFit(item.id, long)
  }, [onFit, item.id, long])
  useEffect(() => () => onFit(item.id, false), [onFit, item.id])
  const end = (item.start + item.duration) / FPS
  const sectionRef = useRef<HTMLElement | null>(null)

  // Growing a scene pushes its words down the page, so it is brought back into view.
  useEffect(() => {
    if (enlarged) sectionRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [enlarged])

  return (
    <section
      ref={sectionRef}
      data-scene-id={item.id}
      aria-label={`Scene ${index + 1}`}
      aria-current={playing ? 'true' : undefined}
      className={cn('relative scroll-my-6 py-6', !first && 'border-t border-paper-border')}
    >
      {/* The scene being played, marked down the margin rather than boxed. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute -left-5 bottom-6 top-6 w-0.5 rounded-full transition-opacity',
          playing ? 'bg-accent-fill opacity-100' : 'opacity-0'
        )}
      />

      <header className="flex items-center gap-4">
        <button
          type="button"
          aria-label={`Play from scene ${index + 1}`}
          onClick={() => {
            onSeek(item.start)
            onSelectItem(item)
          }}
          className="group/thumb relative aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-raised ring-1 ring-paper-border transition-shadow hover:ring-2 hover:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ClipThumbnail item={item} />
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover/thumb:opacity-100">
            <Play size={16} className="text-white" fill="currentColor" aria-hidden="true" />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <h3 className={cn('font-serif text-[17px] leading-tight', playing ? 'text-accent' : 'text-paper-text')}>
            Scene {index + 1}
          </h3>
          <p className="mt-1 text-[11px] text-text-muted">
            {KIND_NAMES[item.kind] ?? 'Clip'} · <span className="tabular-nums">{formatTimecode(item.start / FPS)}–{formatTimecode(end)}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">{statusOf(segment)}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 self-start text-[12px] text-text-muted hover:text-text"
          aria-pressed={enlarged}
          aria-label={`Larger text for scene ${index + 1}`}
          title={enlarged ? 'Back to the usual size' : 'Set this scene’s words large'}
          onClick={onToggleEnlarged}
        >
          {enlarged ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
          {enlarged ? 'Smaller' : 'Larger'}
        </Button>
      </header>

      <TimedText
        value={draft}
        label={label}
        large={enlarged}
        clipSeconds={item.duration / FPS}
        onChange={setDraft}
        onFocus={() => onSelectItem(item)}
        onBlur={() => void commit(draft)}
      />

      <footer className="mt-3 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2">
        {fit && <FitMeter fit={fit} clipSeconds={item.duration / FPS} />}
        <span role="status" className={cn('text-[11px]', recording ? 'text-danger' : 'text-text-muted')}>
          {recording ? 'Recording… read the words aloud, then press Stop' : saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : ''}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Button
            variant="soft"
            size="sm"
            className="h-7 text-[12px]"
            aria-label={drafting ? `Drafting ${label}` : `Draft ${label}`}
            disabled={drafting || narrating || recording}
            onClick={() => onDraft(item)}
          >
            {drafting ? <Spinner size="sm" /> : <Sparkles size={12} aria-hidden="true" />}
            Draft
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 text-[12px]"
            aria-label={narrating ? `Voicing ${label}` : `Voice ${label}`}
            title={draft !== saved ? 'Saving the words first' : 'Read the words in the project’s voice'}
            disabled={narrating || drafting || recording || !draft.trim() || draft !== saved}
            onClick={() => onNarrate(item)}
          >
            {narrating ? <Spinner size="sm" /> : <AudioLines size={12} className="text-accent" aria-hidden="true" />}
            Voice
          </Button>
          {/* The same recorder as the timeline's microphone. Before this the script had only
              Voice, which speaks in the synthetic voice — so pressing it to record your own did
              something else entirely and looked like nothing working. Red, as recording is. */}
          {onRecord && onStopRecording && (
            <Button
              variant={recording ? 'danger' : 'secondary'}
              size="sm"
              className="h-7 text-[12px]"
              aria-label={recording ? `Stop recording ${label}` : `Record ${label} in your own voice`}
              title={recording ? undefined : 'Record yourself reading the words'}
              disabled={!recording && (narrating || drafting || recordingElsewhere)}
              onClick={() => (recording ? onStopRecording() : onRecord(item))}
            >
              {recording ? (
                <Square size={11} fill="currentColor" aria-hidden="true" />
              ) : (
                <Mic size={12} className="text-danger" aria-hidden="true" />
              )}
              {recording ? 'Stop' : 'Record'}
            </Button>
          )}
        </span>
      </footer>
    </section>
  )
}

/** The look both layers of the box share, so a wrapped line falls in the same place in each. */
const TEXT = 'm-0 block w-full border-0 p-0 font-serif whitespace-pre-wrap break-words'

/**
 * The two sizes the words come in. Set on the wrapper and inherited by both layers, so they can
 * never disagree — and so the column, measured in `ch`, widens with the type.
 */
const SIZES = {
  normal: 'text-[15px] leading-[1.7]',
  large: 'text-[22px] leading-[1.6]'
}

/**
 * The words, with their timings drawn as quiet chips.
 *
 * The timings stay typed text — `[2.6] ` is what the store reads back, and what agents and the
 * drafter write — so this is still one textarea. It is transparent over a copy of itself in which
 * the timings are painted; the copy also sets the height, so the box grows with what is written.
 * The chips change only colour and background, never anything that takes up room, or the caret
 * would drift from the letters it sits beside.
 */
function TimedText({
  value,
  label,
  large,
  clipSeconds,
  onChange,
  onFocus,
  onBlur
}: {
  value: string
  label: string
  large: boolean
  clipSeconds: number
  onChange: (value: string) => void
  onFocus: () => void
  onBlur: () => void
}): JSX.Element {
  return (
    <div className={cn('relative mt-4 min-h-[1.7em] max-w-[64ch]', large ? SIZES.large : SIZES.normal)}>
      <div aria-hidden="true" data-testid="script-backdrop" className={cn(TEXT, 'pointer-events-none text-paper-text')}>
        {scriptParts(value).map((part, index) =>
          part.mark ? (
            <span key={index} className="rounded bg-accent/15 text-accent [box-decoration-break:clone]">
              {part.text}
            </span>
          ) : (
            part.text
          )
        )}
        {/* A trailing newline only takes up a line once something follows it. */}
        {value.endsWith('\n') || value === '' ? '​' : null}
      </div>
      <textarea
        value={value}
        aria-label={label}
        placeholder="Nothing said over this one yet. Write it, or press Draft."
        spellCheck
        data-clip-seconds={clipSeconds.toFixed(2)}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        className={cn(
          TEXT,
          'absolute inset-0 h-full resize-none overflow-hidden bg-transparent text-transparent caret-paper-text',
          'selection:bg-accent/30 placeholder:italic placeholder:text-text-muted focus:outline-none'
        )}
      />
    </div>
  )
}

/** Whether the words can be said in the time the clip runs, in the words a writer would use. */
function FitMeter({ fit, clipSeconds }: { fit: NarrationFit; clipSeconds: number }): JSX.Element {
  const said = fit.measured ? `Take runs ${fit.seconds.toFixed(1)}s` : `About ${Math.round(fit.seconds)}s to say`
  return (
    <span className={cn('flex items-center gap-1.5 text-[11px] tabular-nums', fit.long ? 'text-warning' : 'text-text-muted')}>
      {fit.long && <TriangleAlert size={12} aria-hidden="true" />}
      {said} · clip {clipSeconds.toFixed(1)}s{fit.long ? ' — trim the words or lengthen the clip' : ''}
    </span>
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
