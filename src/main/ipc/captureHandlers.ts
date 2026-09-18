import type { IpcMain, BrowserWindow } from 'electron'
import { startRecordingSession, type RecordingResult, type RecordingSession } from '../capture/recordSession'
import { exploreApp } from '../capture/exploreSession'
import { dirname } from 'path'
import { openToolbarWindow, setToolbarEnded, setToolbarMode, setToolbarStatus } from '../capture/toolbarWindow'
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
    const items = await withHistory(projectId, () => importRecordedSession(projectId, recording))
    getWindow()?.webContents.send('project:capture:sessionImported', projectId)
    // One scene at a time, in order: the drafter is told what was said over the clip before
    // this one, so drafting them at once would give every scene the same empty answer.
    void autoDraftAll(projectId, items.map((item) => item.id), getWindow)
  } catch (err) {
    console.error('Could not add the recorded session to the timeline:', err)
    // The video is already on disk, so this is recoverable — but only by someone who has been
    // told. Logging alone left the toolbar claiming to record and the footage unaccounted for.
    setToolbarEnded(explainImportFailure(err, recording))
  }
}

/**
 * Why the recording did not land, in terms of what the person can do about it.
 *
 * The common cause is a project that has gone since recording began — deleted, or the toolbar
 * left open across a switch. `readTimeline` says "No project found with id ..." which is true
 * and useless: what matters is that the video survived and where it is.
 */
export function explainImportFailure(err: unknown, recording: RecordingResult): string {
  const where = recording.clips[0] ? dirname(recording.clips[0].videoPath) : 'the session folder'
  const message = err instanceof Error ? err.message : String(err)

  if (/No project found/i.test(message)) {
    return `That project no longer exists, so there was nowhere to put the recording. It is safe in ${where}.`
  }
  return `Could not add the recording to the timeline: ${message} It is safe in ${where}.`
}

/**
 * End the recording and put it on the timeline.
 *
 * Shared by the stop button and by the walk finishing on its own, because two routes to the
 * same thing are two routes to different bugs — the one that forgets to clear `activeSession`
 * strands the next recording.
 */
async function stopAndImport(
  session: RecordingSession,
  getWindow: () => BrowserWindow | null
): Promise<RecordingResult> {
  stopping = true
  const { projectId } = session
  try {
    const result = await session.stop()
    await importAndNotify(projectId, result, getWindow)
    return result
  } finally {
    activeSession = null
    stopping = false
  }
}

/**
 * How long the walk leaves the recording running after it thinks it is finished.
 *
 * Long enough to read the toolbar and take over — the browser is still open and the demo can be
 * carried on by hand, which is the whole reason this is not instant. Short enough that someone
 * who asked to be shown round and walked away does not come back to ten minutes of a static
 * page on the end of their video.
 */
const FINISH_AFTER_MS = 12_000

/**
 * Walk the app while the recording runs, for someone who asked not to drive it themselves.
 *
 * Started rather than awaited: the toolbar has to come up and its stop button has to work from
 * the first moment, and a walk that is still going when the user presses stop should simply end
 * with everything it recorded up to then. A failure here leaves an ordinary recording the user
 * can drive by hand, which is why it is reported rather than thrown.
 */
async function walkTheApp(session: RecordingSession, getWindow: () => BrowserWindow | null): Promise<void> {
  let result: Awaited<ReturnType<typeof exploreApp>> | undefined
  try {
    setToolbarStatus('Looking around…')
    result = await exploreApp(session.page, session.projectId, {
      // The walk stops the moment the session does, so pressing stop is not waiting on it.
      shouldStop: () => activeSession !== session,
      onProgress: ({ doing, needsYou }) => setToolbarStatus(doing, needsYou)
    })
  } catch (err) {
    console.error('Could not walk the app by itself:', err)
    setToolbarStatus(err instanceof Error ? err.message : 'Could not explore by itself', true)
    return
  }

  // Stopped because the session went away: the stop path is already running and owns the rest.
  if (result.ending === 'stopped' || activeSession !== session) return

  if (result.ending === 'waited-too-long') {
    setToolbarStatus('Gave up waiting to be signed in — press stop when you are done', true)
    return
  }

  if (result.visited.length === 0) {
    setToolbarStatus('Found nothing safe to explore — drive it yourself, then press stop', true)
    return
  }

  // The walk is over, so the recording is too unless the user says otherwise. Asked for rather
  // than done instantly: the browser is still open, and someone may want to carry on by hand.
  setToolbarStatus(`Shown ${result.visited.length} screens — finishing in ${FINISH_AFTER_MS / 1000}s`)
  await new Promise((resolve) => setTimeout(resolve, FINISH_AFTER_MS))

  // Anything the user did in the meantime — pressing stop, or closing the toolbar — wins.
  if (activeSession !== session || stopping) return

  setToolbarStatus('Finishing the recording…')
  try {
    await stopAndImport(session, getWindow)
    // Back to a window a new recording can be started from. Left in recording mode it went on
    // showing a stop button for a session that had already finished.
    setToolbarEnded(`Shown ${result.visited.length} screens. It is on the timeline.`, false)
  } catch (err) {
    console.error('Could not finish the recording after walking the app:', err)
  }
}

/**
 * Draft the narration for a clip that has just landed, when the user has left auto-drafting on.
 *
 * This runs after the editor has already been told about the clip, so the recording appears at
 * once and the words catch up. A provider that is missing or failing is logged and nothing
 * more: the clip is on the timeline either way, and the user can still write their own.
 */
async function autoDraftAll(
  projectId: string,
  timelineItemIds: string[],
  getWindow: () => BrowserWindow | null
): Promise<void> {
  for (const timelineItemId of timelineItemIds) {
    await autoDraft(projectId, timelineItemId, getWindow)
  }
}

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

  ipcMain.handle(
    'project:capture:start',
    async (_event, projectId: string, url: string, explore = false) => {
      if (activeSession || starting) {
        throw new Error('A recording session is already in progress')
      }
      starting = true
      try {
        activeSession = await startRecordingSession(projectId, url)
        setToolbarMode('recording')

        // Closing the browser window is a reasonable way to say "that's the demo". It used to
        // leave the toolbar recording something that no longer existed, with a stop button that
        // could not end it — so it is treated as a stop, and whatever was captured is kept.
        const session = activeSession
        session.onBrowserGone(() => {
          if (activeSession !== session || stopping) return
          void stopAndImport(session, getWindow).catch((err) => {
            console.error('Could not finish the recording after the browser closed:', err)
            setToolbarEnded('The browser closed and the recording could not be saved.')
          })
        })

        if (explore) void walkTheApp(activeSession, getWindow)
        return { sessionId: activeSession.sessionId }
      } finally {
        starting = false
      }
    }
  )

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
    return stopAndImport(activeSession, getWindow)
  })
}
