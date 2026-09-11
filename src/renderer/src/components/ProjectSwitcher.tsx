import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, LayoutGrid } from 'lucide-react'
import { projectClient, type ProjectSummary } from '../api/projectClient'
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
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const containerRef = useRef<HTMLDivElement | null>(null)

  // The list is only needed once the menu is asked for, and it may have changed since last time.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    projectClient.list().then((listed) => {
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
          className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[15rem] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          {projects.map((project) => {
            const isCurrent = project.id === currentProjectId
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
                  'flex w-full items-center gap-2 rounded-none border-0 bg-transparent px-3 py-1.5',
                  'text-left text-sm text-text hover:bg-surface-hover'
                )}
              >
                <Check
                  size={14}
                  aria-hidden="true"
                  className={cn('shrink-0 text-accent', !isCurrent && 'invisible')}
                />
                <span className="truncate">{project.name}</span>
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
