import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, LayoutGrid, Mic } from 'lucide-react'
import { projectClient, type ProjectOverview } from '../api/projectClient'
import { ProjectPoster } from './ProjectPoster'
import { formatTimecode } from '../lib/timelineLayout'
import { FPS } from '../../../remotion/constants'
import { Button } from './ui/Button'
import { cn } from '../lib/cn'

interface ProjectSwitcherProps {
  currentProjectId: string
  currentProjectName: string
  onSwitch: (projectId: string) => void
  onExit: () => void
}

export function ProjectSwitcher({
  currentProjectId,
  currentProjectName,
  onSwitch,
  onExit
}: ProjectSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectOverview[]>([])
  const containerRef = useRef<HTMLDivElement | null>(null)

  // The list is only needed once the menu is asked for, and it may have changed since last time.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    // Overviews rather than names: a demo is recognised by its picture, not its title.
    projectClient.overviews().then((listed) => {
      if (!cancelled) setProjects(listed)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="max-w-[15rem] gap-1.5 text-text"
      >
        <span className="truncate">{currentProjectName}</span>
        <ChevronsUpDown size={13} className="shrink-0 text-text-muted" aria-hidden="true" />
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-[26rem] w-[19rem] overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-xl"
        >
          {projects.map((project) => {
            const isCurrent = project.id === currentProjectId
            const fullyVoiced = project.clipCount > 0 && project.narratedCount === project.clipCount
            return (
              <button
                key={project.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  if (!isCurrent) onSwitch(project.id)
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-none border-0 px-2.5 py-2 text-left',
                  isCurrent ? 'bg-surface-hover' : 'bg-transparent hover:bg-surface-hover'
                )}
              >
                <span className="relative block h-11 w-[4.75rem] shrink-0 overflow-hidden rounded-md border border-border bg-bg">
                  <ProjectPoster project={project} className="h-full w-full" />
                  {project.clipCount > 0 && (
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] tabular-nums text-white">
                      {formatTimecode(project.durationFrames / FPS)}
                    </span>
                  )}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] text-text">{project.name}</span>
                    {isCurrent && <Check size={12} className="shrink-0 text-accent" aria-label="Open" />}
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-text-muted">
                    <span>
                      {project.clipCount} clip{project.clipCount === 1 ? '' : 's'}
                    </span>
                    {project.clipCount > 0 && (
                      <span className={cn('flex items-center gap-0.5', fullyVoiced && 'text-success')}>
                        <Mic size={10} />
                        {fullyVoiced ? 'Voiced' : `${project.narratedCount}/${project.clipCount}`}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            )
          })}

          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onExit()
            }}
            className="flex w-full items-center gap-2 rounded-none border-0 bg-transparent px-3 py-1.5 text-left text-sm text-text hover:bg-surface-hover"
          >
            <LayoutGrid size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
            All projects
          </button>
        </div>
      )}
    </div>
  )
}
