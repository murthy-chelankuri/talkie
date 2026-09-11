import { CircleCheck, Clapperboard, Download, Film, ImagePlus, Mic } from 'lucide-react'
import type { ProjectMetadata, TimelineItem, TranscriptSegment } from '../api/projectClient'
import { segmentsForItem } from '../lib/clipNarration'
import { formatTimecode } from '../lib/timelineLayout'
import { FPS } from '../../../remotion/constants'
import { cn } from '../lib/cn'
import { Spinner } from './ui/Spinner'
import { ErrorBanner } from './ui/ErrorBanner'

function Action({
  icon,
  label,
  hint,
  disabled,
  busy,
  onClick
}: {
  icon: JSX.Element
  label: string
  hint: string
  disabled?: boolean
  busy?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-left',
        'hover:border-accent hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50'
      )}
    >
      <span className="shrink-0 text-accent">{busy ? <Spinner size="sm" /> : icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-text">{label}</span>
        <span className="block truncate text-xs text-text-muted">{hint}</span>
      </span>
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm tabular-nums text-text">{value}</span>
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
  onRecordSession,
  onExport
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
  onRecordSession: () => void
  onExport: () => void
}): JSX.Element {
  const narrated = timeline.filter(
    (item) => segmentsForItem(segments, item.id)[0]?.status === 'narrated'
  ).length

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <div>
        <h2 className="truncate text-base font-semibold text-text">{project.name}</h2>
        <p className="text-xs text-text-muted">Demo project</p>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2.5">
        <Stat label="Duration" value={formatTimecode(totalFrames / FPS)} />
        <Stat label="Clips" value={String(timeline.length)} />
        <Stat label="Narrated" value={`${narrated} of ${timeline.length}`} />
      </div>

      <div className="flex flex-col gap-2">
        <Action
          icon={<Clapperboard size={16} />}
          label="Record a session"
          hint="Capture a walkthrough"
          busy={recording}
          disabled={recording}
          onClick={onRecordSession}
        />
        <Action
          icon={<ImagePlus size={16} />}
          label="Add an image"
          hint="Add a still image"
          onClick={onImportImage}
        />
        <Action
          icon={<Download size={16} />}
          label={exporting ? 'Exporting video' : 'Export video'}
          hint={exporting ? 'Rendering…' : 'Render to MP4'}
          busy={exporting}
          disabled={exporting}
          onClick={onExport}
        />
      </div>

      {recording && (
        <p className="flex items-center gap-2 text-xs text-danger">
          <span className="h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden="true" />
          Recording in progress
        </p>
      )}

      {exportedPath && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface p-2 text-xs text-text-muted">
          <CircleCheck size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
          <span className="min-w-0 break-all">Exported to {exportedPath}</span>
        </p>
      )}

      {(importError || exportError || recordError) && (
        <div className="flex flex-col gap-2">
          {importError && <ErrorBanner message={importError} />}
          {exportError && <ErrorBanner message={exportError} />}
          {recordError && <ErrorBanner message={recordError} />}
        </div>
      )}

      {timeline.length === 0 && (
        <p className="mt-auto flex items-start gap-2 text-xs text-text-muted">
          <Film size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          Record a session or add an image to start the timeline.
        </p>
      )}

      {timeline.length > 0 && narrated < timeline.length && (
        <p className="mt-auto flex items-start gap-2 text-xs text-text-muted">
          <Mic size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {timeline.length - narrated} clip{timeline.length - narrated === 1 ? '' : 's'} still need a
          voice. Write under a clip, then narrate it.
        </p>
      )}
    </div>
  )
}
