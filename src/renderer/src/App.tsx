import { useState } from 'react'
import { ProjectBrowser } from './screens/ProjectBrowser'

export default function App(): JSX.Element {
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)

  if (openProjectId) {
    return <div>Opened project {openProjectId} (Editor screen lands in Task 11)</div>
  }
  return <ProjectBrowser onOpen={setOpenProjectId} />
}
