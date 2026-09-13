import { useState } from 'react'
import { ProjectBrowser } from './screens/ProjectBrowser'
import { Editor } from './screens/Editor'
import { AppShell } from './components/AppShell'
import { ProjectSwitcher } from './components/ProjectSwitcher'
import { projectClient, type ProjectSummary } from './api/projectClient'
import { useMenuActions, useMenuState } from './lib/menuActions'

export default function App(): JSX.Element {
  const [openProject, setOpenProject] = useState<ProjectSummary | null>(null)
  // Bumped to ask the browser to open its create form; a counter rather than a flag so asking
  // twice in a row works.
  const [createRequest, setCreateRequest] = useState(0)

  useMenuState({ projectOpen: openProject !== null })

  useMenuActions({
    // Both leave the editor, because the list is where a project is chosen or started.
    'new-project': () => {
      setOpenProject(null)
      setCreateRequest((n) => n + 1)
    },
    'open-project': () => setOpenProject(null)
  })

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
        <ProjectBrowser onOpen={setOpenProject} createRequest={createRequest} />
      )}
    </AppShell>
  )
}
