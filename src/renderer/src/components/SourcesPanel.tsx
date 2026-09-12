import {
  Clapperboard,
  Download,
  Film,
  ImagePlus,
  Menu,
  Mic,
  Presentation
} from 'lucide-react'
import type { ProjectMetadata, TimelineItem, TranscriptSegment } from '../api/projectClient'
import { segmentsForItem } from '../lib/clipNarration'
import { formatTimecode } from '../lib/timelineLayout'
import { formatRelativeTime } from '../lib/formatRelativeTime'
import { FPS } from '../../../remotion/constants'
import { cn } from '../lib/cn'
import { IconButton } from './ui/IconButton'
import { Spinner } from './ui/Spinner'
import { ErrorBanner } from './ui/ErrorBanner'
import { ExportedCard } from './ExportedCard'

/**
 * Each action carries its own colour so the rail can be read at a glance when it is too narrow
 * for words. Red belongs to recording, which is where it already means something everywhere
 * else in the app; brass belongs to export, being the app's own colour and the last step.
 */
type Tone = 'record' | 'media' | 'slides' | 'export'

const TONE_TEXT: Record<Tone, string> = {
  record: 'text-danger',
  media: 'text-media',
  slides: 'text-slides',
  export: 'text-accent'
}

const TONE_CHIP: Record<Tone, string> = {
  record: 'bg-danger/10',
  media: 'bg-media/10',
  slides: 'bg-slides/10',
  export: 'bg-accent/10'
}

interface ActionProps {
  icon: JSX.Element
  label: string
  hint: string
  tone: Tone
  collapsed: boolean
  disabled?: boolean
  busy?: boolean
  onClick: () => void
}

function Action({ icon, label, hint, tone, collapsed, disabled, busy, onClick }: ActionProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={collapsed ? `${label} — ${hint}` : undefined}
      className={cn(
        'flex items-center rounded-lg border border-border bg-surface text-left transition-colors',
        'hover:border-accent hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50',
        collapsed ? 'justify-center p-2' : 'w-full gap-2.5 px-2.5 py-2.5'
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
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-text">{label}</span>
          <span className="block truncate text-[11px] text-text-muted">{hint}</span>
        </span>
      )}
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
function ProjectSummary({
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
    <div className="mb-4 flex flex-col gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-3">
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-2xl leading-none tabular-nums text-text">
          {formatTimecode(totalFrames / FPS)}
        </span>
        <span className="text-[11px] text-text-muted">
          {clipCount} clip{clipCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="h-1 overflow-hidden rounded-full bg-border">
          <div
            className={cn('h-full rounded-full transition-[width]', complete ? 'bg-success' : 'bg-accent')}
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

export function SourcesPanel({
  project,
  timeline,
  segments,
  totalFrames,
  recording,
  exporting,
  exportedPath,
  importError,
  exportError,
  recordError,
  onImportImage,
  onImportDeck,
  importingDeck,
  deckProgress,
  onRecordSession,
  onExport,
  onDismissExport,
  collapsed,
  onToggleCollapsed
}: {
  project: ProjectMetadata
  timeline: TimelineItem[]
  segments: TranscriptSegment[]
  totalFrames: number
  recording: boolean
  exporting: boolean
  exportedPath: string | null
  importError: string | null
  exportError: string | null
  recordError: string | null
  onImportImage: () => void
  onImportDeck: () => void
  importingDeck: boolean
  deckProgress: string | null
  onRecordSession: () => void
  onExport: () => void
  onDismissExport: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
}): JSX.Element {
  const narrated = timeline.filter(
    (item) => segmentsForItem(segments, item.id)[0]?.status === 'narrated'
  ).length

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-y-auto border-r border-border bg-bg transition-[width] duration-150',
        collapsed ? 'w-[3.75rem] items-center px-2 py-3' : 'w-60 p-3.5'
      )}
    >
      <div className={cn('mb-4 flex items-center gap-2', collapsed && 'justify-center')}>
        {/* The same icon button the app header uses, so it reads as a control rather than
            decoration — the earlier borderless version was missed entirely. */}
        <IconButton
          aria-label={collapsed ? 'Show the sources panel' : 'Collapse the sources panel'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Show the panel' : 'Collapse the panel'}
          onClick={onToggleCollapsed}
        >
          <Menu size={16} />
        </IconButton>
        {!collapsed && (
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold leading-tight text-text">{project.name}</h2>
            <p className="truncate text-[11px] text-text-muted">
              Started {formatRelativeTime(project.createdAt)}
            </p>
          </div>
        )}
      </div>

      {!collapsed && (
        <ProjectSummary totalFrames={totalFrames} clipCount={timeline.length} narrated={narrated} />
      )}

      {!collapsed && exportedPath && (
        <div className="mb-4">
          <ExportedCard path={exportedPath} onDismiss={onDismissExport} />
        </div>
      )}

      <div className={cn('flex flex-col gap-2', collapsed && 'items-center')}>
        <Action
          icon={<Clapperboard size={15} />}
          label="Record a session"
          hint="Capture a walkthrough"
          tone="record"
          collapsed={collapsed}
          busy={recording}
          disabled={recording}
          onClick={onRecordSession}
        />
        <Action
          icon={<ImagePlus size={15} />}
          label="Add an image"
          hint="Drop in a slide or screenshot"
          tone="media"
          collapsed={collapsed}
          onClick={onImportImage}
        />
        <Action
          icon={<Presentation size={15} />}
          label={importingDeck ? 'Importing slides' : 'Import slides'}
          hint={importingDeck ? (deckProgress ?? 'Working…') : 'From a .pptx or .pdf deck'}
          tone="slides"
          collapsed={collapsed}
          busy={importingDeck}
          disabled={importingDeck}
          onClick={onImportDeck}
        />
        <Action
          icon={<Download size={15} />}
          label={exporting ? 'Exporting video' : 'Export video'}
          hint={exporting ? 'Rendering…' : 'Render to MP4'}
          tone="export"
          collapsed={collapsed}
          busy={exporting}
          disabled={exporting}
          onClick={onExport}
        />
      </div>

      {recording && (
        <p
          className={cn('mt-3 flex items-center gap-2 text-[11px] text-danger', collapsed && 'justify-center')}
          title="Recording in progress"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden="true" />
          {!collapsed && 'Recording in progress'}
        </p>
      )}

      {!collapsed && (importError || exportError || recordError) && (
        <div className="mt-3 flex flex-col gap-2">
          {importError && <ErrorBanner message={importError} />}
          {exportError && <ErrorBanner message={exportError} />}
          {recordError && <ErrorBanner message={recordError} />}
        </div>
      )}

      {!collapsed && timeline.length === 0 && (
        <p className="mt-auto flex items-start gap-2 pt-4 text-[11px] text-text-muted">
          <Film size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          Record a session or add an image to start the timeline.
        </p>
      )}

      {!collapsed && timeline.length > 0 && narrated < timeline.length && (
        <p className="mt-auto flex items-start gap-2 pt-4 text-[11px] text-text-muted">
          <Mic size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          {timeline.length - narrated} clip{timeline.length - narrated === 1 ? ' is' : 's are'} still
          silent. Write under a clip, then narrate it.
        </p>
      )}

    </div>
  )
}
