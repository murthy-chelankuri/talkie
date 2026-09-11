import { useState } from 'react'
import { ProjectBrowser } from './screens/ProjectBrowser'
import { Editor } from './screens/Editor'
import { AppShell } from './components/AppShell'
import { ProjectSwitcher } from './components/ProjectSwitcher'
import { projectClient, type ProjectSummary } from './api/projectClient'

export default function App(): JSX.Element {
  const [openProject, setOpenProject] = useState<ProjectSummary | null>(null)

  async function switchProject(projectId: string): Promise<void> {
    setOpenProject(await projectClient.open(projectId))
  }

  return (
    <AppShell
      breadcrumb={
        openProject && (
          <ProjectSwitcher
            currentProjectId={openProject.id}
            currentProjectName={openProject.name}
            onSwitch={switchProject}
            onExit={() => setOpenProject(null)}
          />
        )
      }
    >
      {openProject ? (
        // Keyed so switching projects starts the Editor fresh rather than carrying over
        // the previous project's timeline, selection and history.
        <Editor key={openProject.id} projectId={openProject.id} />
      ) : (
        <ProjectBrowser onOpen={setOpenProject} />
      )}
    </AppShell>
  )
}
