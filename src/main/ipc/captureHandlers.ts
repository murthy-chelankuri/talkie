import type { IpcMain, BrowserWindow } from 'electron'
import { startRecordingSession, type RecordingResult, type RecordingSession } from '../capture/recordSession'
import { openToolbarWindow, setToolbarMode } from '../capture/toolbarWindow'
import { importRecordedSession } from '../capture/importRecordedSession'
import { withHistory } from '../project/history'
import { readSettings } from '../settings/settingsStore'
import { draftNarrationForItem } from '../agent/draftNarration'

let activeSession: RecordingSession | null = null
let starting = false
let stopping = false

// Turning the finished recording into a timeline item is deliberately non-fatal: the video and
// action log are already safely on disk at this point, so an import failure must not fail the
// stop itself (which would strand the session). The Editor is only told to refresh on success.
async function importAndNotify(
  projectId: string,
  recording: RecordingResult,
  getWindow: () => BrowserWindow | null
): Promise<void> {
  try {
    const item = await withHistory(projectId, () => importRecordedSession(projectId, recording))
    getWindow()?.webContents.send('project:capture:sessionImported', projectId)
    void autoDraft(projectId, item.id, getWindow)
  } catch (err) {
    console.error('Could not add the recorded session to the timeline:', err)
  }
}

/**
 * Draft the narration for a clip that has just landed, when the user has left auto-drafting on.
 *
 * This runs after the editor has already been told about the clip, so the recording appears at
 * once and the words catch up. A provider that is missing or failing is logged and nothing
 * more: the clip is on the timeline either way, and the user can still write their own.
 */
async function autoDraft(
  projectId: string,
  timelineItemId: string,
  getWindow: () => BrowserWindow | null
): Promise<void> {
  if (!readSettings().narration.autoDraft) return

  try {
    const result = await withHistory(projectId, () => draftNarrationForItem(projectId, timelineItemId))
    if (result.status === 'drafted') {
      getWindow()?.webContents.send('project:agent:drafted', projectId)
    } else if (result.status === 'failed') {
      console.error(`Could not draft narration for the new clip: ${result.reason}`)
    }
  } catch (err) {
    console.error('Could not draft narration for the new clip:', err)
  }
}

export function registerCaptureHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null): void {
  function stopActiveSessionIfAny(): void {
    if (!activeSession || stopping) return
    stopping = true
    const { projectId } = activeSession
    activeSession
      .stop()
      .then((result) => importAndNotify(projectId, result, getWindow))
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
      setToolbarMode('recording')
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
      await importAndNotify(projectId, result, getWindow)
      return result
    } finally {
      activeSession = null
      stopping = false
    }
  })
}
