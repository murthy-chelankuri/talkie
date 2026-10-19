import { useEffect, useState } from 'react'
import { CircleX, Download, Loader2, RotateCcw, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { ExportedCard } from '../ExportedCard'
import { cn } from '../../lib/cn'
import { describeDuration, describeTimeLeft, secondsLeft } from '../../lib/exportTime'
import type { ExportProgress, ExportResult } from '../../api/projectClient'

export type ExportState =
  | { status: 'idle' }
  | { status: 'running'; progress: ExportProgress; startedAt: number; cancelling?: boolean }
  | ExportResult

const STAGE_TEXT: Record<ExportProgress['stage'], (progress: ExportProgress) => string> = {
  preparing: () => 'Getting the scenes ready',
  rendering: ({ renderedFrames, totalFrames }) =>
    `Drawing frame ${renderedFrames.toLocaleString()} of ${totalFrames.toLocaleString()}`,
  encoding: () => 'Putting the video file together',
  finishing: () => 'Levelling the sound and writing captions'
}

/**
 * Export, in the top bar: it is the last step of every project and the one thing that leaves the
 * app, so it is never behind a panel.
 *
 * It says what it is doing the whole way. It used to grey out and spin for the minutes an export
 * takes, which looked the same whether it was nearly done, stuck, or had quietly failed — so
 * while it runs it shows the step, a bar, the time left and a way to stop, and when it ends it
 * says how: the file, why it could not, or that it was cancelled.
 */
export function ExportControl({
  state,
  onExport,
  onCancel,
  onDismiss
}: {
  state: ExportState
  onExport: () => void
  onCancel: () => void
  onDismiss: () => void
}): JSX.Element {
  const running = state.status === 'running'
  const [panelHidden, setPanelHidden] = useState(false)
  useEffect(() => setPanelHidden(false), [state.status])
  const percent = running ? Math.floor(state.progress.fraction * 100) : 0

  return (
    <div className="relative">
      <Button
        size="sm"
        onClick={running ? () => setPanelHidden((hidden) => !hidden) : onExport}
        aria-label={running ? `Exporting video, ${percent}%` : 'Export video'}
        aria-expanded={running ? !panelHidden : undefined}
        className="relative overflow-hidden"
      >
        {running ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} />}
        {running ? `Exporting ${percent}%` : 'Export video'}
        {running && (
          // The bar along the button's foot, so the progress is visible with the panel shut.
          <span
            aria-hidden="true"
            className="absolute bottom-0 left-0 h-[3px] bg-on-accent/70 transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        )}
      </Button>

      {state.status !== 'idle' && !(running && panelHidden) && (
        <div className="absolute right-0 top-full z-40 mt-2 flex w-80 flex-col gap-2 rounded-xl bg-surface p-3 shadow-2xl">
          {state.status === 'running' && <Running state={state} percent={percent} onCancel={onCancel} />}
          {state.status === 'done' && (
            <ExportedCard path={state.path} took={describeDuration(state.seconds)} onDismiss={onDismiss} />
          )}
          {state.status === 'failed' && (
            <Ended
              tone="danger"
              title="Export failed"
              detail={state.message}
              onRetry={onExport}
              onDismiss={onDismiss}
            />
          )}
          {state.status === 'cancelled' && (
            <Ended tone="muted" title="Export cancelled" detail="Nothing was saved." onRetry={onExport} onDismiss={onDismiss} />
          )}
        </div>
      )}
    </div>
  )
}

function Running({
  state,
  percent,
  onCancel
}: {
  state: Extract<ExportState, { status: 'running' }>
  percent: number
  onCancel: () => void
}): JSX.Element {
  // Ticks on its own, so the time left moves between progress reports rather than in jumps.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = Math.max(0, now - state.startedAt)
  const left = describeTimeLeft(secondsLeft(elapsed, state.progress.fraction))

  return (
    <div className="flex flex-col gap-2.5 p-1" role="status" aria-label="Export progress">
      <div className="flex items-center gap-2">
        <Loader2 size={15} className="shrink-0 animate-spin text-accent" aria-hidden="true" />
        <span className="flex-1 text-[13px] font-medium text-text">
          {state.cancelling ? 'Stopping the export…' : 'Exporting video'}
        </span>
        <span className="text-[13px] font-medium tabular-nums text-text">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Export"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-raised"
      >
        <div className="h-full rounded-full bg-accent-fill transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
        <span>{STAGE_TEXT[state.progress.stage](state.progress)}</span>
        <span className="shrink-0 tabular-nums">{left ?? formatElapsed(elapsed)}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-text-muted">
        You can keep editing. The video is made from the project as it was when you pressed Export.
      </p>
      <Button size="sm" variant="secondary" onClick={onCancel} disabled={state.cancelling}>
        Cancel export
      </Button>
    </div>
  )
}

function Ended({
  tone,
  title,
  detail,
  onRetry,
  onDismiss
}: {
  tone: 'danger' | 'muted'
  title: string
  detail: string
  onRetry: () => void
  onDismiss: () => void
}): JSX.Element {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex flex-col gap-2.5 rounded-lg p-3',
        tone === 'danger' ? 'border border-danger/40 bg-danger/6' : 'bg-raised'
      )}
    >
      <div className="flex items-start gap-2">
        <CircleX
          size={15}
          className={cn('mt-0.5 shrink-0', tone === 'danger' ? 'text-danger' : 'text-text-muted')}
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-text">{title}</span>
          {/* Selectable and scrollable: a render error is often long, and someone may need to paste it. */}
          <span className="max-h-28 select-text overflow-y-auto wrap-break-word text-[11px] text-text-muted">{detail}</span>
        </div>
        <IconButton aria-label="Dismiss" onClick={onDismiss} className="-mr-1 -mt-1 h-6 w-6">
          <X size={13} />
        </IconButton>
      </div>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        <RotateCcw size={13} />
        Export again
      </Button>
    </div>
  )
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
