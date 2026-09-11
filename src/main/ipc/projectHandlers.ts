import type { IpcMain } from 'electron'
import { homedir } from 'os'
import {
  createProject,
  listProjects,
  listProjectOverviews,
  openProject,
  sweepUnusedNarrationAudio,
  deleteProject
} from '../project/projectApi'
import { projectsRootDir } from '../project/paths'
import { getAssetServer, resolveAssetUrl } from '../render/assetServer'
import { clearHistory, historyState, redo, undo } from '../project/history'

export function registerProjectHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('project:create', (_event, name: string) => createProject(name))
  ipcMain.handle('project:list', () => listProjects())

  ipcMain.handle('project:overviews', async () => {
    const rootDir = projectsRootDir(homedir())
    const overviews = listProjectOverviews()
    if (!overviews.some((overview) => overview.posterPath)) return overviews

    // Poster media lives on disk; the renderer can only fetch it through the asset server.
    const assetServer = await getAssetServer(rootDir)
    return overviews.map((overview) =>
      overview.posterPath
        ? { ...overview, posterPath: resolveAssetUrl(overview.posterPath, rootDir, assetServer.url) }
        : overview
    )
  })

  ipcMain.handle('project:open', (_event, id: string) => {
    const project = openProject(id)
    sweepUnusedNarrationAudio(id)
    return project
  })

  ipcMain.handle('project:delete', (_event, id: string) => {
    deleteProject(id)
    // Its undo stack points at files that no longer exist, and a recycled id must not inherit it.
    clearHistory(id)
  })

  ipcMain.handle('project:history:state', (_event, id: string) => historyState(id))
  ipcMain.handle('project:history:undo', (_event, id: string) => undo(id))
  ipcMain.handle('project:history:redo', (_event, id: string) => redo(id))
}
