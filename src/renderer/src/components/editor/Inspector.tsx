import type { ReactNode } from 'react'
import { AudioLines, Pencil, Scissors, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import type { TimelineItem, TranscriptSegment } from '../../api/projectClient'
import type { VoiceProgress } from '../../lib/voiceProgress'
import { segmentsForItem } from '../../lib/clipNarration'
import { formatTimecode } from '../../lib/timelineLayout'
import { KIND_NAMES } from '../../lib/clipKinds'
import { FPS } from '../../../../composition/constants'
import { VARIANT_FOR } from '../../../../composition/sceneTheme'
import { computeTimelineDuration } from '../../../../composition/timelineDuration'
import type { TimelineItem as CompositionTimelineItem } from '../../../../composition/types'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Segmented } from '../ui/Segmented'
import { Spinner } from '../ui/Spinner'

type Look = 'brand' | 'light' | 'dark'

/** Scenes have a look and an editor; recordings and images are what they are. */
const SCENE_KINDS = new Set(['scene', 'diagram', 'html'])

const LOOKS: { id: Look; label: string }[] = [
  { id: 'brand', label: 'Brand' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
]

/**
 * The right-hand column: whatever is selected on the timeline, or the project when nothing is.
 *
 * It follows the selection the timeline already has rather than keeping one of its own, so
 * clicking a clip anywhere — the timeline, the script — is all it takes. Editing a scene's words
 * still opens the scene editor; what is here is what can be decided at a glance.
 */
export function Inspector({
  item,
  timeline,
  segments,
  progress,
  themeName,
  note,
  playheadFrame,
  busy,
  onEdit,
  onLook,
  onNarrate,
  onDraft,
  onSplit,
  onDelete,
  version,
  onToggleIncluded
}: {
  item: TimelineItem | null
  timeline: TimelineItem[]
  segments: TranscriptSegment[]
  progress: VoiceProgress
  /** The project's theme, or null for Talkie's own look. */
  themeName: string | null
  /** A line about the project as a whole, shown while nothing is selected. */
  note?: string | null
  /** Where the playhead is, in frames of the whole video — read when Split is pressed. */
  playheadFrame: () => number
  busy: { narrating: boolean; drafting: boolean }
  onEdit: (item: TimelineItem) => void
  onLook: (item: TimelineItem, look: Look) => void | Promise<void>
  onNarrate: (item: TimelineItem) => void
  onDraft: (item: TimelineItem) => void
  onSplit: (item: TimelineItem, atFrame: number) => void
  onDelete: (item: TimelineItem) => void
  /** The version being worked on: its name, how long it plays, and what it leaves out. */
  version?: { name: string; frames: number; leftOut: readonly string[] }
  onToggleIncluded?: (item: TimelineItem, included: boolean) => void
}): JSX.Element {
  if (!item) {
    // The length of what plays and exports, which is the version's when it leaves scenes out.
    const total = version?.leftOut.length ? version.frames : computeTimelineDuration(timeline as unknown as CompositionTimelineItem[])
    return (
      <Column title="Project">
        <Row label="Length" value={formatTimecode(total / FPS)} />
        {version && version.leftOut.length > 0 && (
          <Row label={version.name} value={`${version.leftOut.length} scene${version.leftOut.length === 1 ? '' : 's'} left out`} />
        )}
        <Row label="Voice" value={timeline.length === 0 ? 'Nothing yet' : `${progress.voiced} of ${timeline.length} voiced`} />
        <Row label="Theme" value={themeName ?? 'Talkie’s own look'} />
        {note && (
          <p className="mt-2 flex items-start gap-2 rounded-[10px] bg-raised p-2.5 text-[11px] leading-relaxed text-text-muted">
            <AudioLines size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            {note}
          </p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
          {timeline.length === 0 ? 'Open Add in the rail to record a session or add a scene.' : 'Select a clip to see it here.'}
        </p>
      </Column>
    )
  }

  const data = (item.data ?? {}) as {
    title?: string
    style?: { theme?: string }
    trimBefore?: number
    trimAfter?: number
    check?: { problems: string[] }
  }
  const index = timeline.findIndex((clip) => clip.id === item.id)
  const voice = segmentsForItem(segments, item.id).find((segment) => segment.voice)?.voice
  const isScene = SCENE_KINDS.has(item.kind)
  const look = VARIANT_FOR[(data.style?.theme ?? 'dark') as keyof typeof VARIANT_FOR] ?? 'dark'
  const playhead = playheadFrame()
  const playheadInside = playhead > item.start && playhead < item.start + item.duration

  return (
    <Column title={KIND_NAMES[item.kind] ?? 'Clip'} aside={`Clip ${index + 1} of ${timeline.length}`}>
      {data.title && <p className="-mt-1 text-[13px] leading-snug text-text">{data.title.replace(/<[^>]*>/g, '')}</p>}

      {isScene && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-text-muted">Look</span>
          <Segmented label="Look" value={look} options={LOOKS} onChange={(next) => void onLook(item, next)} />
        </div>
      )}

      {item.kind === 'video' && (
        <Row
          label="Footage"
          value={`${formatTimecode((data.trimBefore ?? 0) / FPS)}–${formatTimecode((data.trimAfter ?? (data.trimBefore ?? 0) + item.duration) / FPS)}`}
        />
      )}
      <Row label="Length" value={formatTimecode(item.duration / FPS)} />
      <Row label="Voice" value={voice ?? 'No voice yet'} />
      {version && onToggleIncluded && (
        <label className="flex items-center justify-between gap-3 text-[12px]">
          <span className="text-text-muted">In {version.name}</span>
          <input
            type="checkbox"
            role="switch"
            aria-label={`In the version ${version.name}`}
            checked={!version.leftOut.includes(item.id)}
            onChange={(event) => onToggleIncluded(item, event.target.checked)}
            className="h-4 w-4 accent-accent-fill"
          />
        </label>
      )}

      {(data.check?.problems.length ?? 0) > 0 && (
        <section aria-label="What the check found" className="flex flex-col gap-1 rounded-[10px] bg-danger-bg p-2.5">
          {data.check!.problems.map((problem) => (
            <span key={problem} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-text">
              <TriangleAlert size={12} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
              {problem}
            </span>
          ))}
        </section>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        {isScene && (
          <Button variant="soft" onClick={() => onEdit(item)}>
            <Pencil size={13} />
            Edit
          </Button>
        )}
        <div className="flex gap-1.5">
          <Button variant="secondary" size="sm" className="flex-1" aria-label="Voice it again" disabled={busy.narrating} onClick={() => onNarrate(item)}>
            {busy.narrating ? <Spinner size="sm" label="Voicing" /> : <AudioLines size={13} className="text-accent" />}
            {busy.narrating ? 'Voicing…' : 'Voice'}
          </Button>
          <Button variant="secondary" size="sm" className="flex-1" aria-label="Write the words" disabled={busy.drafting} onClick={() => onDraft(item)}>
            {busy.drafting ? <Spinner size="sm" label="Writing" /> : <Sparkles size={13} className="text-accent" />}
            {busy.drafting ? 'Writing…' : 'Write'}
          </Button>
          <IconButton aria-label="Split at playhead" disabled={!playheadInside} onClick={() => onSplit(item, playheadFrame())}>
            <Scissors size={14} />
          </IconButton>
          <IconButton aria-label="Delete clip" onClick={() => onDelete(item)} className="hover:text-danger">
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>
    </Column>
  )
}

function Column({ title, aside, children }: { title: string; aside?: string; children: ReactNode }): JSX.Element {
  return (
    <aside aria-label="Inspector" className="flex h-full min-w-0 flex-col gap-3 overflow-y-auto rounded-xl bg-surface p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-text">{title}</h2>
        {aside && <span className="text-[11px] text-text-muted">{aside}</span>}
      </header>
      {children}
    </aside>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="text-text-muted">{label}</span>
      <span className="truncate text-right tabular-nums text-text">{value}</span>
    </div>
  )
}
