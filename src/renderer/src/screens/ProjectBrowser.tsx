import { useEffect, useRef, useState } from 'react'
import { Clapperboard, Film, Image as ImageIcon, Mic, Plus, Trash2 } from 'lucide-react'
import { projectClient, type ProjectOverview, type ProjectSummary } from '../api/projectClient'
import { formatRelativeTime } from '../lib/formatRelativeTime'
import { formatTimecode } from '../lib/timelineLayout'
import { FPS } from '../../../remotion/constants'
import { cn } from '../lib/cn'
import { Button } from '../components/ui/Button'
import { IconButton } from '../components/ui/IconButton'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'

function Poster({ project }: { project: ProjectOverview }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const startSeconds = (project.posterTrimBefore ?? 0) / FPS

  useEffect(() => {
    const video = videoRef.current
    if (!video || startSeconds <= 0) return
    const seek = (): void => {
      video.currentTime = startSeconds
    }
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seek()
      return
    }
    video.addEventListener('loadedmetadata', seek, { once: true })
    return () => video.removeEventListener('loadedmetadata', seek)
  }, [startSeconds, project.posterPath])

  if (!project.posterPath) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-hover text-text-muted">
        <Film size={20} aria-hidden="true" />
      </div>
    )
  }

  if (project.posterKind === 'video') {
    return (
      <video
        ref={videoRef}
        src={project.posterPath}
        muted
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        className="h-full w-full object-cover"
      />
    )
  }

  return <img src={project.posterPath} alt="" className="h-full w-full object-cover" />
}

function ProjectCard({
  project,
  onOpen,
  onDelete
}: {
  project: ProjectOverview
  onOpen: (project: ProjectSummary) => void
  onDelete: (project: ProjectOverview) => Promise<void>
}): JSX.Element {
  const fullyNarrated = project.clipCount > 0 && project.narratedCount === project.clipCount
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  return (
    <div className="group relative">
      <button
        type="button"
        // Without a label the card's name is its whole run of stats, which reads poorly and
        // collides with the delete button beside it.
        aria-label={`Open ${project.name}`}
        onClick={() => onOpen(project)}
        className={cn(
          'flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface p-0 text-left',
          'transition-colors hover:border-accent hover:bg-surface-hover'
        )}
      >
        <span className="relative block aspect-video w-full overflow-hidden bg-bg">
          <Poster project={project} />
          {project.clipCount > 0 && (
            <span className="absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
              {formatTimecode(project.durationFrames / FPS)}
            </span>
          )}
        </span>

        <span className="flex flex-col gap-1 px-3.5 py-3">
          <span className="truncate text-[15px] font-medium text-text">{project.name}</span>
          <span className="flex items-center gap-3 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              {project.posterKind === 'image' ? <ImageIcon size={12} /> : <Film size={12} />}
              {project.clipCount} clip{project.clipCount === 1 ? '' : 's'}
            </span>
            {project.clipCount > 0 && (
              <span className={cn('flex items-center gap-1', fullyNarrated && 'text-success')}>
                <Mic size={12} />
                {fullyNarrated ? 'Voiced' : `${project.narratedCount}/${project.clipCount}`}
              </span>
            )}
            <span className="ml-auto">{formatRelativeTime(project.createdAt)}</span>
          </span>
        </span>
      </button>

      {/* The delete control sits beside the card rather than inside it: a button cannot nest. */}
      <IconButton
        aria-label={`Delete ${project.name}`}
        onClick={() => setConfirming(true)}
        className={cn(
          'absolute right-2 top-2 bg-surface/90 text-text-muted backdrop-blur',
          'opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100',
          confirming && 'hidden'
        )}
      >
        <Trash2 size={15} />
      </IconButton>

      {confirming && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl border border-danger bg-surface/95 px-5 text-center backdrop-blur">
          <p className="text-sm text-text">
            Delete <span className="font-medium">{project.name}</span>?
          </p>
          <p className="text-xs text-text-muted">
            Its recordings, narration and timeline go with it. This cannot be undone.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="bg-danger text-white hover:bg-danger"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true)
                try {
                  await onDelete(project)
                } finally {
                  setDeleting(false)
                  setConfirming(false)
                }
              }}
            >
              {deleting ? <Spinner size="sm" /> : 'Delete'}
            </Button>
            <Button variant="ghost" size="sm" disabled={deleting} onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ProjectBrowser({ onOpen }: { onOpen: (project: ProjectSummary) => void }): JSX.Element {
  const [projects, setProjects] = useState<ProjectOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    projectClient
      .overviews()
      .then(setProjects)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  async function handleCreate(): Promise<void> {
    if (!newName.trim()) return
    setError(null)
    setCreating(true)
    try {
      const created = await projectClient.create(newName.trim())
      setNewName('')
      setShowCreateForm(false)
      onOpen(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(project: ProjectOverview): Promise<void> {
    setError(null)
    try {
      await projectClient.remove(project.id)
      setProjects((current) => current.filter((p) => p.id !== project.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleCancelCreate(): void {
    setShowCreateForm(false)
    setNewName('')
  }

  const createForm = (
    <div className="flex w-full max-w-md flex-col gap-2 rounded-xl border border-accent bg-surface p-4">
      <Input
        autoFocus
        aria-label="Project name"
        value={newName}
        onChange={(event) => setNewName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') handleCreate()
          if (event.key === 'Escape') handleCancelCreate()
        }}
        placeholder="What are you demoing?"
        disabled={creating}
      />
      <div className="flex gap-2">
        <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
          {creating ? <Spinner size="sm" /> : 'Create project'}
        </Button>
        <Button variant="ghost" onClick={handleCancelCreate} disabled={creating}>
          Cancel
        </Button>
      </div>
    </div>
  )

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-8 px-8 py-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl leading-tight text-text">Your demos</h1>
          <p className="mt-1 text-sm text-text-muted">
            Record it silent. Give it a voice.
          </p>
        </div>
        {!showCreateForm && projects.length > 0 && (
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus size={16} />
            New project
          </Button>
        )}
      </header>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size="md" label="Loading projects" />
        </div>
      ) : projects.length === 0 && !showCreateForm ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <span className="rounded-2xl border border-border bg-surface p-4 text-accent">
            <Clapperboard size={28} aria-hidden="true" />
          </span>
          <div>
            <p className="font-serif text-xl text-text">No demos yet</p>
            <p className="mt-1 text-sm text-text-muted">
              Start a project, then record the browser session you want to walk through.
            </p>
          </div>
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus size={16} />
            New project
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {showCreateForm && createForm}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={onOpen}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
