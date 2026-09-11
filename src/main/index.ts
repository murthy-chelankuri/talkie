import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { join } from 'path'
import { registerProjectHandlers } from './ipc/projectHandlers'
import { registerTimelineHandlers } from './ipc/timelineHandlers'
import { registerCaptureHandlers } from './ipc/captureHandlers'
import { registerTranscriptHandlers } from './ipc/transcriptHandlers'
import { migrateStorageRoot } from './project/migrateStorageRoot'
import { repairAssetPaths } from './project/repairAssetPaths'

let mainWindowRef: BrowserWindow | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false
    }
  })
  mainWindowRef = mainWindow

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * A failure during start-up otherwise leaves a process running with no window and nothing
 * written anywhere — the app simply appears not to open. Say what happened instead.
 */
function reportFatal(context: string, err: unknown): void {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error(`${context}:`, message)
  dialog.showErrorBox('Talkie could not start', `${context}\n\n${message}`)
  app.exit(1)
}

process.on('uncaughtException', (err) => reportFatal('Something went wrong', err))

app.whenReady().then(() => {
  // Before any handler can read a project, bring a previous installation's projects across
  // and point their media at wherever the files now sit.
  migrateStorageRoot()
  repairAssetPaths()

  // Recording a narration take needs the microphone, and Electron denies it unless asked.
  // Nothing else is granted: a request for anything but audio is refused.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media')
  })

  registerProjectHandlers(ipcMain)
  registerTimelineHandlers(ipcMain, () => mainWindowRef)
  registerCaptureHandlers(ipcMain, () => mainWindowRef)
  registerTranscriptHandlers(ipcMain)
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((err) => reportFatal('Talkie could not finish starting up', err))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
