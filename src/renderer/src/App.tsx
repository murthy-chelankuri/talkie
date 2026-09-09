import { useState } from 'react'
import { ProjectBrowser } from './screens/ProjectBrowser'
import { Editor } from './screens/Editor'
import { AppShell } from './components/AppShell'

export default function App(): JSX.Element {
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)

  return (
    <AppShell>
      {openProjectId ? <Editor projectId={openProjectId} /> : <ProjectBrowser onOpen={setOpenProjectId} />}
    </AppShell>
  )
}
