import { app, BrowserWindow, ipcMain } from 'electron'
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
      preload: join(__dirname, '../preload/index.mjs'),
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

app.whenReady().then(() => {
  // Before any handler can read a project, bring a previous installation's projects across
  // and point their media at wherever the files now sit.
  migrateStorageRoot()
  repairAssetPaths()

  registerProjectHandlers(ipcMain)
  registerTimelineHandlers(ipcMain, () => mainWindowRef)
  registerCaptureHandlers(ipcMain, () => mainWindowRef)
  registerTranscriptHandlers(ipcMain)
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
