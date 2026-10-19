import { useEffect, useState } from 'react'
import { ProjectBrowser } from './screens/ProjectBrowser'
import { Editor } from './screens/Editor'
import { AppShell } from './components/AppShell'
import { RewriteStatus } from './components/RewriteStatus'
import { ProjectSwitcher } from './components/ProjectSwitcher'
import { projectClient, type ProjectSummary } from './api/projectClient'
import { useMenuActions, useMenuState } from './lib/menuActions'
import { rememberLastProject } from './lib/lastProject'
import { notifySettingsChanged } from './lib/settingsChanged'

export default function App(): JSX.Element {
  const [openProject, setOpenProject] = useState<ProjectSummary | null>(null)
  // Bumped to ask the browser to open its create form; a counter rather than a flag so asking
  // twice in a row works.
  const [createRequest, setCreateRequest] = useState(0)

  useMenuState({ projectOpen: openProject !== null })

  // The Studio's settings and themes can change under the app with a git pull, so coming back to
  // the window reads them again, as a change made in Settings would.
  useEffect(() => {
    window.addEventListener('focus', notifySettingsChanged)
    return () => window.removeEventListener('focus', notifySettingsChanged)
  }, [])

  useMenuActions({
    // Both leave the editor, because the list is where a project is chosen or started.
    'new-project': () => {
      setOpenProject(null)
      setCreateRequest((n) => n + 1)
    },
    'open-project': () => setOpenProject(null)
  })

  async function switchProject(projectId: string): Promise<void> {
    // Switching is opening too: the home screen leads with whichever was opened last.
    rememberLastProject(projectId)
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
      <RewriteStatus />
    </AppShell>
  )
}
