import { BookOpen } from 'lucide-react'
import type { ProjectMetadata } from '../../api/projectClient'
import { formatRelativeTime } from '../../lib/formatRelativeTime'
import { ProjectSummary } from './parts'

/** The project at a glance: its length and how much of it speaks, and what the model is told about it. */
export function ProjectPanel({
  project,
  totalFrames,
  clipCount,
  narrated,
  hasContext,
  onEditContext
}: {
  project: ProjectMetadata
  totalFrames: number
  clipCount: number
  narrated: number
  /** Whether this project has been described to the model yet. */
  hasContext: boolean
  onEditContext: () => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="min-w-0">
        <p className="truncate font-serif text-[18px] leading-tight text-text">{project.name}</p>
        <p className="truncate text-[11px] text-text-muted">Started {formatRelativeTime(project.createdAt)}</p>
      </div>

      <ProjectSummary totalFrames={totalFrames} clipCount={clipCount} narrated={narrated} />

      {/* Set once per project and rarely revisited, so a line that opens a dialog rather than
          permanent space in a panel. */}
      <button
        type="button"
        onClick={onEditContext}
        className="flex w-full items-start gap-2 rounded-xl bg-raised p-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <BookOpen size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[12px] font-medium text-text">About this project</span>
          <span className="text-[11px] leading-relaxed text-text-muted">
            {hasContext
              ? 'What the model knows before it writes, and the theme the video is drawn in.'
              : 'Tell the model what this is, and the words it writes stop being generic.'}
          </span>
        </span>
      </button>
    </div>
  )
}
