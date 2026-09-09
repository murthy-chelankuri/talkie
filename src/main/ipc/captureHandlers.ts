import type { IpcMain } from 'electron'
import { startRecordingSession, type RecordingSession } from '../capture/recordSession'
import { openToolbarWindow } from '../capture/toolbarWindow'

let activeSession: RecordingSession | null = null
let starting = false
let stopping = false

function stopActiveSessionIfAny(): void {
  if (!activeSession || stopping) return
  stopping = true
  activeSession
    .stop()
    .catch((err) => console.error('Error stopping recording after toolbar closed:', err))
    .finally(() => {
      activeSession = null
      stopping = false
    })
}

export function registerCaptureHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('project:capture:openToolbar', (_event, projectId: string) => {
    openToolbarWindow(projectId, stopActiveSessionIfAny)
  })

  ipcMain.handle('project:capture:start', async (_event, projectId: string, url: string) => {
    if (activeSession || starting) {
      throw new Error('A recording session is already in progress')
    }
    starting = true
    try {
      activeSession = await startRecordingSession(projectId, url)
      return { sessionId: activeSession.sessionId }
    } finally {
      starting = false
    }
  })

  ipcMain.handle('project:capture:mark', (_event, annotation: 'important' | 'redo' | 'skip') => {
    if (!activeSession) {
      throw new Error('No recording session is in progress')
    }
    activeSession.markAnnotation(annotation)
  })

  ipcMain.handle('project:capture:stop', async () => {
    if (!activeSession) {
      throw new Error('No recording session is in progress')
    }
    if (stopping) {
      throw new Error('A stop is already in progress')
    }
    stopping = true
    try {
      const result = await activeSession.stop()
      return result
    } finally {
      activeSession = null
      stopping = false
    }
  })
}
