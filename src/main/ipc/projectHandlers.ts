import type { IpcMain } from 'electron'
import { createProject, listProjects, openProject } from '../project/projectApi'

export function registerProjectHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('project:create', (_event, name: string) => createProject(name))
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:open', (_event, id: string) => openProject(id))
}
