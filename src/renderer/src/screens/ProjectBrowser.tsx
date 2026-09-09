import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { projectClient, type ProjectSummary } from '../api/projectClient'
import { formatRelativeTime } from '../lib/formatRelativeTime'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { EmptyState } from '../components/ui/EmptyState'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'

export function ProjectBrowser({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    projectClient
      .list()
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
      onOpen(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  function handleCancelCreate(): void {
    setShowCreateForm(false)
    setNewName('')
  }

  function renderContent(): JSX.Element {
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size="md" label="Loading projects" />
        </div>
      )
    }

    if (projects.length === 0 && !showCreateForm) {
      return (
        <EmptyState
          title="No projects yet"
          description="Create your first project to get started."
          action={<Button onClick={() => setShowCreateForm(true)}>New Project</Button>}
        />
      )
    }

    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
        {showCreateForm ? (
          <Card className="flex flex-col gap-2">
            <Input
              autoFocus
              aria-label="Project name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              disabled={creating}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancelCreate} disabled={creating}>
                Cancel
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="border-dashed p-0">
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg p-4 text-text-muted hover:bg-surface-hover hover:text-text"
            >
              <Plus size={20} aria-hidden="true" />
              <span className="text-sm font-medium">New Project</span>
            </button>
          </Card>
        )}
        {projects.map((project) => (
          <Card key={project.id} className="p-0">
            <button
              type="button"
              onClick={() => onOpen(project.id)}
              className="flex w-full flex-col gap-1 rounded-lg p-4 text-left hover:bg-surface-hover"
            >
              <span className="text-sm font-medium text-text">{project.name}</span>
              <span className="text-xs text-text-muted">{formatRelativeTime(project.createdAt)}</span>
            </button>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold text-text">Demo Editor</h1>
      {error && <ErrorBanner message={error} />}
      {renderContent()}
    </div>
  )
}
