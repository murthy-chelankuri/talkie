import type { BrowserWindow, IpcMain } from 'electron'
import { findProjectDir } from '../project/paths'
import { openProject } from '../project/projectApi'
import { clearHistory } from '../project/history'
import { watchProjectFolder, type ProjectWatcher } from '../project/projectWatcher'
import { isProjectAgentRunning } from '../agent/projectAgent'
import type { DiskChange } from '../project/diskChange'

let current: { projectId: string; watcher: ProjectWatcher } | null = null

function stopWatching(): void {
  current?.watcher.close()
  current = null
}

/** The window came forward: catch up on anything a watch might have missed. */
export function checkWatchedProject(): void {
  current?.watcher.check()
}

/**
 * The app has just taken in everything on disk for this project — the end of an in-app agent run —
 * so a change still settling in the watcher is not news, and must not cost the run its undo step.
 */
export function acceptWatchedProject(projectId: string): void {
  if (current?.projectId === projectId) current.watcher.accept()
}

export function registerProjectWatchHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null): void {
  // The editor says which project it has open; one at a time, as there is one editor.
  ipcMain.handle('project:watch', (_event, projectId: string | null) => {
    stopWatching()
    if (!projectId) return
    const dir = findProjectDir(projectId)
    if (!dir) return
    const watcher = watchProjectFolder(dir, () => {
      // The in-app agent's changes are one undo step of their own (project:agent:instruct).
      const historyCleared = !isProjectAgentRunning(projectId)
      if (historyCleared) clearHistory(projectId)
      const change: DiskChange = { historyCleared }
      getWindow()?.webContents.send('project:changedOnDisk', projectId, change)
    })
    current = { projectId, watcher }
  })

  // Only reads. project:open also tidies the folder — sweeping takes nothing points at — which,
  // done while an agent is between writing a take and pointing a scene at it, would delete the take.
  ipcMain.handle('project:metadata', (_event, projectId: string) => openProject(projectId))
}
