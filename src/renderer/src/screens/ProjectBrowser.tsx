import { useEffect, useState } from 'react'
import { projectClient, type ProjectSummary } from '../api/projectClient'

export function ProjectBrowser({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [newName, setNewName] = useState('')

  useEffect(() => {
    projectClient.list().then(setProjects)
  }, [])

  async function handleCreate(): Promise<void> {
    if (!newName.trim()) return
    const created = await projectClient.create(newName.trim())
    setNewName('')
    onOpen(created.id)
  }

  return (
    <div>
      <h1>Demo Editor</h1>
      <div>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New project name"
        />
        <button onClick={handleCreate}>Create</button>
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
