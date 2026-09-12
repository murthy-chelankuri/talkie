import {
  AudioLines,
  BookOpen,
  Clapperboard,
  Download,
  Film,
  ImagePlus,
  LayoutTemplate,
  Menu,
  Presentation
} from 'lucide-react'
import type { ProjectMetadata, TimelineItem, TranscriptSegment } from '../api/projectClient'
import { segmentsForItem } from '../lib/clipNarration'
import { voiceProgressHint, type VoiceProgress } from '../lib/voiceProgress'
import { formatTimecode } from '../lib/timelineLayout'
import { formatRelativeTime } from '../lib/formatRelativeTime'
import { FPS } from '../../../remotion/constants'
import { cn } from '../lib/cn'
import type { Voice } from '../api/projectClient'
import { Button } from './ui/Button'
import { FOLLOWS_DEFAULT, VoicePicker } from './VoicePicker'
import { IconButton } from './ui/IconButton'
import { Spinner } from './ui/Spinner'
import { ErrorBanner } from './ui/ErrorBanner'
import { ExportedCard } from './ExportedCard'

/**
 * Each action carries its own colour so the rail can be read at a glance when it is too narrow
 * for words. Red belongs to recording, which is where it already means something everywhere
 * else in the app; brass belongs to export, being the app's own colour and the last step.
 */
type Tone = 'record' | 'media' | 'slides' | 'scene' | 'export'

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
  icon: JSX.Element
  label: string
  hint: string
  tone: Tone
  collapsed: boolean
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
function Action({
  icon,
  label,
  hint,
  tone,
  collapsed,
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
      title={collapsed ? `${label} — ${hint}` : undefined}
      className={cn(
        'flex items-center rounded-lg border text-left transition-colors',
        'hover:border-accent hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50',
        primary ? 'border-accent/45 bg-accent/[0.07] shadow-sm' : 'border-border bg-surface',
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
  progress,
  currentVoice,
  onKeepProjectVoice,
  projectVoice,
  appVoice,
  hasContext,
  onEditContext,
  voices,
  onProjectVoiceChange,
  recording,
  exporting,
  exportedPath,
  importError,
  exportError,
  recordError,
  onImportImage,
  onImportDeck,
  onAddScene,
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
  /** Clips still waiting on a voice, counted once in the editor and shared from there. */
  progress: VoiceProgress
  currentVoice: string
  /** Adopt the voice the narration was read in, instead of re-speaking it. */
  onKeepProjectVoice?: () => void
  /** Whether this project has been described to the model yet. */
  hasContext: boolean
  onEditContext: () => void
  /** The voice pinned to this project, or null when it follows the app's. */
  projectVoice: string | null
  appVoice: string
  voices: Voice[]
  onProjectVoiceChange: (voice: string | null) => void
  recording: boolean
  exporting: boolean
  exportedPath: string | null
  importError: string | null
  exportError: string | null
  recordError: string | null
  onImportImage: () => void
  onImportDeck: () => void
  onAddScene: () => void
  importingDeck: boolean
  deckProgress: string | null
  onRecordSession: () => void
  onExport: () => void
  onDismissExport: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
}): JSX.Element {
  // Voiced means it has audio. Which voice read it is a separate question, asked below.
  const narrated = progress.voiced
  const hint = voiceProgressHint(progress, currentVoice)

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

      {/* Set once per project and rarely revisited, so a line that opens a dialog rather than
          permanent space in a panel that is already full. */}
      {!collapsed && (
        <button
          type="button"
          onClick={onEditContext}
          className="mt-2 flex w-full items-start gap-2 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-accent"
        >
          <BookOpen size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[11px] font-medium text-text">About this project</span>
            <span className="text-[11px] leading-relaxed text-text-muted">
              {hasContext
                ? 'What the model knows before it writes.'
                : 'Tell the model what this is, and the words it writes stop being generic.'}
            </span>
          </span>
        </button>
      )}

      {/* The voice this project speaks in, always here rather than only when something is wrong.
          It was reachable only from a card that appeared on a mismatch, which meant a voice
          could be chosen once and never changed again. */}
      {!collapsed && (
        <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-3">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-medium text-text">Voice</span>
            {!projectVoice && (
              <span className="text-[10px] text-text-muted">from Settings</span>
            )}
          </span>
          <VoicePicker
            ariaLabel="Voice for this project"
            value={projectVoice ?? FOLLOWS_DEFAULT}
            voices={voices}
            onChange={(next) => onProjectVoiceChange(next === FOLLOWS_DEFAULT ? null : next)}
            // Short enough to read whole in a narrow panel, where the long form was cut off.
            defaultOption={{ label: appVoice ? `App default (${appVoice})` : 'App default' }}
          />
        </div>
      )}

      {/* Under the summary, because it qualifies it. A loose line of text here read as something
          left unstyled; what it actually needs is a card, because two of these states are a
          decision rather than a notice. */}
      {!collapsed && timeline.length > 0 && hint && (
        <div
          className={cn(
            'mt-2 flex flex-col gap-2 rounded-lg border p-3',
            progress.otherVoice.length > 0 && progress.silent.length === 0
              ? 'border-accent/40 bg-accent/[0.06]'
              : 'border-border bg-surface'
          )}
        >
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-text-muted">
            <AudioLines size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            {hint}
          </p>

          {/* Only for the mismatch: the project already sounds finished, so keeping it as it is
              has to be as easy as changing it. */}
          {onKeepProjectVoice && progress.previousVoice && progress.silent.length === 0 && (
            <Button variant="ghost" size="sm" className="self-start" onClick={onKeepProjectVoice}>
              Keep {progress.previousVoice} for this project
            </Button>
          )}
        </div>
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
          primary
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
          icon={<LayoutTemplate size={15} />}
          label="Add a scene"
          hint="Write a slide or a diagram"
          tone="scene"
          collapsed={collapsed}
          onClick={onAddScene}
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


    </div>
  )
}
