import type { IpcMain } from 'electron'
import { startRecordingSession, type RecordingSession } from '../capture/recordSession'
import { openToolbarWindow } from '../capture/toolbarWindow'

let activeSession: RecordingSession | null = null
let stopping = false

export function registerCaptureHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('project:capture:openToolbar', (_event, projectId: string) => {
    openToolbarWindow(projectId)
  })

  ipcMain.handle('project:capture:start', async (_event, projectId: string, url: string) => {
    if (activeSession) {
      throw new Error('A recording session is already in progress')
    }
    activeSession = await startRecordingSession(projectId, url)
    return { sessionId: activeSession.sessionId }
  })

  ipcMain.handle('project:capture:mark', (_event, annotation: 'important' | 'redo' | 'skip') => {
    if (!activeSession) {
      throw new Error('No recording session is in progress')
    }
    activeSession.markAnnotation(annotation)
  })

  ipcMain.handle('project:capture:stop', async () => {
    if (!activeSession || stopping) {
      throw new Error('No recording session is in progress')
    }
    stopping = true
    try {
      const result = await activeSession.stop()
      activeSession = null
      return result
    } finally {
      stopping = false
    }
  })
}
