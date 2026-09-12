import { useEffect, useRef, useState } from 'react'
import { AudioLines, Mic, Sparkles, Square } from 'lucide-react'
import type { TimelineItem, TranscriptSegment } from '../api/projectClient'
import { hasStaleVoice, narrationTextForItem, segmentsForItem, voiceOf, RECORDED_VOICE } from '../lib/clipNarration'
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
  currentVoice,
  drafting,
  recording,
  onRecord,
  onStopRecording,
  onDraft,
  onCommit,
  onNarrate,
  compact = false
}: {
  item: TimelineItem
  segments: TranscriptSegment[]
  active: boolean
  /** Too narrow to read words in. See the textarea below. */
  compact?: boolean
  narrating: boolean
  currentVoice: string
  drafting: boolean
  recording: boolean
  onRecord: (item: TimelineItem) => void | Promise<void>
  onStopRecording: () => void | Promise<void>
  onDraft: (item: TimelineItem) => void | Promise<void>
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
  // Changing the voice does not re-record anything, so say which voice this take is in.
  const staleVoice = hasStaleVoice(segments, item.id, currentVoice)
  const recordedVoice = voiceOf(segments, item.id)
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
      {/* Whose voice this is, and whether it has one, is the voice layer's job now — saying it
          here too only left less room for the words. What is left is the one thing the layer
          cannot show, because it is happening right now. */}
      <div className="flex items-center gap-1.5 border-b border-paper-border px-1.5 py-1">
        {recording && (
          <>
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden="true" />
            <span className="truncate text-[10px] text-danger">Recording…</span>
          </>
        )}
        <IconButton
          aria-label={recording ? `Stop recording ${label}` : `Record ${label} in your own voice`}
          className={cn(
            'ml-auto h-5 w-5 shrink-0',
            recording ? 'text-danger' : 'text-text-muted hover:text-danger'
          )}
          disabled={narrating || drafting || !draft.trim()}
          onClick={() => (recording ? onStopRecording() : onRecord(item))}
        >
          {/* A microphone, for the one action on this row that uses one. */}
          {recording ? <Square size={11} fill="currentColor" /> : <Mic size={12} />}
        </IconButton>
        <IconButton
          aria-label={drafting ? `Drafting ${label}` : `Draft ${label}`}
          className="h-5 w-5 shrink-0 text-text-muted hover:text-accent"
          disabled={drafting || narrating || recording}
          onClick={() => onDraft(item)}
        >
          {drafting ? <Spinner size="sm" /> : <Sparkles size={12} />}
        </IconButton>
        <IconButton
          aria-label={narrating ? `Narrating ${label}` : `Narrate ${label}`}
          className="h-5 w-5 shrink-0 text-text-muted hover:text-accent"
          disabled={narrating || recording || !draft.trim() || draft !== savedText}
          onClick={() => onNarrate(item)}
        >
          {/* A voice coming out, not going in — this speaks the words with the chosen voice. */}
          {narrating ? <Spinner size="sm" /> : <AudioLines size={12} />}
        </IconButton>
      </div>
      {/* A box narrower than a word breaks text one letter to a line, which is unreadable and
          looks broken. Below that width the status and the controls are the useful part; the
          words are read by zooming in, or in the clip that is under the playhead. */}
      {!compact && (
        <textarea
          value={draft}
          aria-label={label}
          placeholder="Narration…"
          // How long this clip runs, for "fit the clip" in the right-click menu. The field is
          // the only thing that knows which clip it belongs to.
          data-clip-seconds={(item.duration / FPS).toFixed(2)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onCommit(item, draft)}
          className="min-h-0 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 font-serif text-[13px] leading-relaxed text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
        />
      )}
    </div>
  )
}
