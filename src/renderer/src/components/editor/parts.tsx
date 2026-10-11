import type { ReactNode } from 'react'
import { formatTimecode } from '../../lib/timelineLayout'
import { FPS } from '../../../../remotion/constants'
import { cn } from '../../lib/cn'
import { Spinner } from '../ui/Spinner'

/**
 * Pieces the editor's side panels share, moved here from the old sources column when it was split
 * into the Project, Add and Voice panels.
 */

/**
 * Each way of adding something carries its own colour, so the list reads at a glance. Red belongs
 * to recording, which is where it already means something everywhere else in the app.
 */
export type Tone = 'record' | 'media' | 'slides' | 'scene' | 'export'

const TONE_TEXT: Record<Tone, string> = {
  record: 'text-danger',
  media: 'text-media',
  slides: 'text-slides',
  scene: 'text-success',
  export: 'text-accent'
}

const TONE_CHIP: Record<Tone, string> = {
  record: 'bg-danger/10',
  media: 'bg-media/10',
  slides: 'bg-slides/10',
  scene: 'bg-success/10',
  export: 'bg-accent/10'
}

interface ActionProps {
  icon: ReactNode
  label: string
  hint: string
  tone: Tone
  disabled?: boolean
  busy?: boolean
  /** The one thing this panel is really for. Exactly one action should carry it. */
  primary?: boolean
  onClick: () => void
}

/**
 * One of the ways to put something on the timeline.
 *
 * Five of these at identical weight made recording — the thing the app is for — look like one
 * option among five, so the first among them is drawn as the one to reach for and the rest read
 * as the alternatives they are.
 */
export function Action({
  icon,
  label,
  hint,
  tone,
  disabled,
  busy,
  primary,
  onClick
}: ActionProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left transition-colors',
        'hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        primary ? 'bg-danger/[0.08] ring-1 ring-inset ring-danger/25' : 'bg-raised'
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
          TONE_CHIP[tone],
          TONE_TEXT[tone]
        )}
      >
        {busy ? <Spinner size="sm" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-text">{label}</span>
        <span className="block truncate text-[11px] text-text-muted">{hint}</span>
      </span>
    </button>
  )
}

/**
 * The panel's one piece of status, written as a sentence rather than a table.
 *
 * Three rows of label and value read like debug output and give equal weight to three unequal
 * things. What is being worked towards is a finished length with every clip voiced, so the
 * length leads and the voicing is a bar you can see fill up.
 */
export function ProjectSummary({
  totalFrames,
  clipCount,
  narrated
}: {
  totalFrames: number
  clipCount: number
  narrated: number
}): JSX.Element {
  const complete = clipCount > 0 && narrated === clipCount
  const progress = clipCount === 0 ? 0 : (narrated / clipCount) * 100

  return (
    <div className="flex flex-col gap-2.5 rounded-xl bg-raised px-3.5 py-3">
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-2xl leading-none tabular-nums text-text">
          {formatTimecode(totalFrames / FPS)}
        </span>
        <span className="text-[11px] text-text-muted">
          {clipCount} clip{clipCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="h-1 overflow-hidden rounded-full bg-surface-hover">
          <div
            className={cn('h-full rounded-full transition-[width]', complete ? 'bg-success' : 'bg-accent-gradient')}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className={cn('text-[11px]', complete ? 'text-success' : 'text-text-muted')}>
          {clipCount === 0
            ? 'Nothing on the timeline yet'
            : complete
              ? 'Every clip has a voice'
              : `${narrated} of ${clipCount} clips voiced`}
        </span>
      </div>
    </div>
  )
}

