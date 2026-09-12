import { useEffect, useState } from 'react'
import { AudioLines, Clapperboard, Film, Image as ImageIcon, Plus, Trash2 } from 'lucide-react'
import {
  projectClient,
  type ProjectContext,
  type ProjectOverview,
  type ProjectSummary
} from '../api/projectClient'
import { EMPTY_CONTEXT, hasProjectContext } from '../../../main/project/projectContext'
import { formatRelativeTime } from '../lib/formatRelativeTime'
import { formatTimecode } from '../lib/timelineLayout'
import { FPS } from '../../../remotion/constants'
import { cn } from '../lib/cn'
import { ProjectPoster } from '../components/ProjectPoster'

/** "pricing, roadmap" as two rules. Written once, used when the project is made. */
function splitRules(value: string): string[] {
  return value
    .split(',')
    .map((rule) => rule.trim())
    .filter(Boolean)
}
import { Button } from '../components/ui/Button'
import { IconButton } from '../components/ui/IconButton'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Textarea'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'

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
          <ProjectPoster project={project} className="h-full w-full" />
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
                <AudioLines size={12} />
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
  const [newContext, setNewContext] = useState<ProjectContext>(EMPTY_CONTEXT)
  const [showMore, setShowMore] = useState(false)
  // Held as typed, not as parsed: deriving the field's value from the parsed list deleted the
  // comma on the keystroke that made it, so "pricing, roadmap" became one rule called
  // "pricingroadmap".
  const [neverSayText, setNeverSayText] = useState('')
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
      const context = { ...newContext, neverSay: splitRules(neverSayText) }
      const created = await projectClient.create(
        newName.trim(),
        hasProjectContext(context) ? context : undefined
      )
      setNewName('')
      setNewContext(EMPTY_CONTEXT)
      setNeverSayText('')
      setShowMore(false)
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
    setNewContext(EMPTY_CONTEXT)
    setNeverSayText('')
    setShowMore(false)
  }

  /**
   * Asked while the answer is in mind.
   *
   * This is the one moment someone is actively thinking about what they are about to make, and
   * the only field that has ever been asked for is the name. But a form in the way of starting
   * is worse than a panel found later, so only the question that does the most work is shown —
   * the other three are a click away, and every one of them can be left empty.
   */
  const createForm = (
    <div className="flex w-full max-w-xl flex-col gap-3 rounded-xl border border-accent bg-surface p-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-text">Name</span>
        <Input
          autoFocus
          aria-label="Project name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) handleCreate()
            if (event.key === 'Escape') handleCancelCreate()
          }}
          placeholder="What are you showing?"
          disabled={creating}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-text">What it is about</span>
        <span className="text-[11px] leading-relaxed text-text-muted">
          The narration is written from this. Without it, the words can only describe what moved
          on screen. You can change it later.
        </span>
        <Textarea
          aria-label="What this project is about"
          value={newContext.background}
          onChange={(event) => setNewContext((c) => ({ ...c, background: event.target.value }))}
          placeholder={
            'Acme Ads is a self-serve advertising tool for small shops.\nA saved group of customers is an "audience". Budgets are always daily.'
          }
          disabled={creating}
          className="min-h-[5rem] resize-y leading-relaxed"
        />
      </label>

      {showMore && (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-text">Who is watching</span>
            <Input
              aria-label="Who is watching"
              value={newContext.audience}
              onChange={(event) => setNewContext((c) => ({ ...c, audience: event.target.value }))}
              placeholder="Shop owners who have never bought advertising before"
              disabled={creating}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-text">How it should sound</span>
            <Input
              aria-label="How it should sound"
              value={newContext.tone}
              onChange={(event) => setNewContext((c) => ({ ...c, tone: event.target.value }))}
              placeholder="Plain and reassuring. No jargon."
              disabled={creating}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-text">Never say</span>
            <Input
              aria-label="Never say"
              value={neverSayText}
              onChange={(event) => setNeverSayText(event.target.value)}
              placeholder="pricing, roadmap"
              disabled={creating}
            />
          </label>
        </>
      )}

      {!showMore && (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="flex items-center gap-1 self-start rounded border-0 bg-transparent px-0 py-0 text-[11px] text-accent hover:underline"
        >
          <Plus size={11} />
          Audience, tone and rules
        </button>
      )}

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
          <h1 className="font-serif text-3xl leading-tight text-text">Your projects</h1>
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
            <p className="font-serif text-xl text-text">No projects yet</p>
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
