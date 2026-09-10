import type { IpcMain, BrowserWindow } from 'electron'
import { startRecordingSession, type RecordingSession } from '../capture/recordSession'
import { openToolbarWindow } from '../capture/toolbarWindow'
import { importRecordedSession } from '../capture/importRecordedSession'

let activeSession: RecordingSession | null = null
let starting = false
let stopping = false

// Turning the finished recording into a timeline item is deliberately non-fatal: the video and
// action log are already safely on disk at this point, so an import failure must not fail the
// stop itself (which would strand the session). The Editor is only told to refresh on success.
async function importAndNotify(
  projectId: string,
  videoPath: string,
  getWindow: () => BrowserWindow | null
): Promise<void> {
  try {
    await importRecordedSession(projectId, videoPath)
    getWindow()?.webContents.send('project:capture:sessionImported', projectId)
  } catch (err) {
    console.error('Could not add the recorded session to the timeline:', err)
  }
}

export function registerCaptureHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null): void {
  function stopActiveSessionIfAny(): void {
    if (!activeSession || stopping) return
    stopping = true
    const { projectId } = activeSession
    activeSession
      .stop()
      .then((result) => importAndNotify(projectId, result.videoPath, getWindow))
      .catch((err) => console.error('Error stopping recording after toolbar closed:', err))
      .finally(() => {
        activeSession = null
        stopping = false
      })
  }

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
    const { projectId } = activeSession
    try {
      const result = await activeSession.stop()
      await importAndNotify(projectId, result.videoPath, getWindow)
      return result
    } finally {
      activeSession = null
      stopping = false
    }
  })
}
