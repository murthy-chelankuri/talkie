import { useEffect, useState } from 'react'
import { projectClient, type ProjectMetadata } from '../api/projectClient'

export function Editor({ projectId }: { projectId: string }): JSX.Element {
  const [project, setProject] = useState<ProjectMetadata | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    projectClient
      .open(projectId)
      .then(setProject)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [projectId])

  if (error) return <div>{error}</div>
  if (!project) return <div>Loading…</div>

  return (
    <div style={{ display: 'grid', gridTemplateRows: '1fr auto', height: '100vh' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 260px' }}>
        <aside>Sources &amp; Agents</aside>
        <main>Preview — {project.name}</main>
        <aside>Transcript</aside>
      </div>
      <footer style={{ height: 160 }}>Timeline</footer>
    </div>
  )
}
