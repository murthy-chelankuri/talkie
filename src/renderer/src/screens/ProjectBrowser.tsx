import { useEffect, useState } from 'react'
import { projectClient, type ProjectSummary } from '../api/projectClient'

export function ProjectBrowser({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    projectClient
      .list()
      .then(setProjects)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  async function handleCreate(): Promise<void> {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const created = await projectClient.create(newName.trim())
      setNewName('')
      onOpen(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <h1>Demo Editor</h1>
      {error && <div>{error}</div>}
      <div>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New project name"
        />
        <button onClick={handleCreate} disabled={creating}>
          Create
        </button>
      </div>
      <ul>
        {projects.map((project) => (
          <li key={project.id}>
            <button onClick={() => onOpen(project.id)}>{project.name}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
