import { shell, type IpcMain } from 'electron'
import { describeStudio } from '../studio/describeStudio'
import { ensureStudio, studioDir } from '../studio/studio'

export function registerStudioHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('settings:studio:describe', () => describeStudio())
  ipcMain.handle('settings:studio:reveal', async () => {
    ensureStudio()
    // openPath answers with an error message, empty when it worked.
    return (await shell.openPath(studioDir())) || null
  })
}
