import { useState } from 'react'
import { ProjectBrowser } from './screens/ProjectBrowser'
import { Editor } from './screens/Editor'

export default function App(): JSX.Element {
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)

  if (openProjectId) {
    return <Editor projectId={openProjectId} />
  }
  return <ProjectBrowser onOpen={setOpenProjectId} />
}
