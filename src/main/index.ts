import { app, BrowserWindow, dialog, ipcMain, screen, session } from 'electron'
import { join } from 'path'
import { registerProjectHandlers } from './ipc/projectHandlers'
import { registerTimelineHandlers } from './ipc/timelineHandlers'
import { registerCaptureHandlers } from './ipc/captureHandlers'
import { registerTranscriptHandlers } from './ipc/transcriptHandlers'
import { registerThemeHandlers } from './ipc/themeHandlers'
import { registerHtmlSceneHandlers } from './ipc/htmlSceneHandlers'
import { migrateStorageRoot } from './project/migrateStorageRoot'
import { MIN_HEIGHT, MIN_WIDTH, openingBounds, saveWindowState } from './windowState'
import { repairAssetPaths } from './project/repairAssetPaths'
import { installExamples } from './examples/installExamples'
import { registerEditContextMenu } from './menu/editContextMenu'
import { installApplicationMenu, INITIAL_MENU_STATE, type MenuState } from './menu/applicationMenu'
import { mayUse } from './security/permissions'
import { cancelAllExports, exportsRunning } from './render/exportJob'
import { applyContentSecurityPolicy } from './security/contentSecurityPolicy'
import { closeAssetServer } from './render/assetServer'
import { applyNavigationGuards } from './security/navigationGuards'
import { configureLog, logEvent, logFailure } from './diagnostics/log'
import { logHandlerFailures, logWindowErrors } from './diagnostics/appLogging'
import { readBuildInfo } from './diagnostics/buildInfo'
import { registerDiagnosticsHandlers } from './ipc/diagnosticsHandlers'

let mainWindowRef: BrowserWindow | null = null

function createWindow(): void {
  // Sized to the screen rather than to a number chosen once: a fixed 1280x800 is a small window
  // on most displays, and this is an app whose preview wants the room.
  const bounds = openingBounds(screen.getPrimaryDisplay().workArea)

  const mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false
    }
  })
  mainWindowRef = mainWindow

  // Right-clicking text reaches the system's own text features from here — see editContextMenu.
  registerEditContextMenu(mainWindow.webContents)
  logWindowErrors(mainWindow.webContents)

  // Shown once it has something to draw, rather than as an empty frame that then fills in.
  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Remembered on settle rather than on every pixel of a drag.
  let saveTimer: NodeJS.Timeout | undefined
  const remember = (): void => {
    if (mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isFullScreen()) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveWindowState(mainWindow.getNormalBounds()), 400)
  }
  mainWindow.on('resize', remember)
  mainWindow.on('move', remember)
  mainWindow.on('close', () => {
    clearTimeout(saveTimer)
    if (!mainWindow.isMinimized() && !mainWindow.isFullScreen()) {
      saveWindowState(mainWindow.getNormalBounds())
    }
  })

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
  logFailure(context, err)
  dialog.showErrorBox('Talkie could not start', `${context}\n\n${message}`)
  app.exit(1)
}

process.on('uncaughtException', (err) => reportFatal('Something went wrong', err))
// Not fatal — the app carries on — but the one record of a promise nobody was waiting on.
process.on('unhandledRejection', (reason) => logFailure('A failure nothing handled', reason))

configureLog({ source: 'app' })

app.whenReady().then(() => {
  const build = readBuildInfo()
  logEvent(`Talkie started (${build ? `${build.version}, ${build.commit?.slice(0, 7) ?? 'no commit'}` : `${app.getVersion()}, build unknown`}, ${app.isPackaged ? 'installed' : 'from a checkout'})`)
  // Before any handler exists, so every one is covered.
  logHandlerFailures(ipcMain)

  // Before any handler can read a project, bring a previous installation's projects across
  // and point their media at wherever the files now sit.
  migrateStorageRoot()
  repairAssetPaths()
  // After the repairs, so an example lands in a projects folder that is already where it belongs.
  // Never fatal: an app that cannot copy its examples is still an app.
  try {
    installExamples()
  } catch (err) {
    console.error('Could not install the example projects:', err)
  }

  // Applied to every window the app ever creates, including the recording toolbar, rather than
  // to each one at the point it is built and forgotten for the next one.
  app.on('web-contents-created', (_event, contents) => applyNavigationGuards(contents))

  // What the renderer may load and where it may connect. Set before the window exists, so the
  // first document is covered rather than only the ones after it.
  applyContentSecurityPolicy(session.defaultSession, Boolean(process.env['ELECTRON_RENDERER_URL']))

  // Electron denies everything unless asked. What this app needs and nothing else — see
  // security/permissions.ts for what is on the list and why.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(mayUse(permission))
  })

  // The default Electron menu has no File items beyond closing the window, which is what the
  // app shipped with. Rebuilt whenever the window's state changes, since an item's enabled flag
  // is decided when the menu is built.
  let menuState: MenuState = INITIAL_MENU_STATE
  installApplicationMenu(() => mainWindowRef, menuState)
  ipcMain.handle('menu:setState', (_event, next: Partial<MenuState>) => {
    const merged = { ...menuState, ...next }
    // Rebuilding on every keystroke would be wasteful; nothing changes unless a flag does.
    if (merged.projectOpen === menuState.projectOpen && merged.canUndo === menuState.canUndo && merged.canRedo === menuState.canRedo) {
      return
    }
    menuState = merged
    installApplicationMenu(() => mainWindowRef, menuState)
  })

  registerProjectHandlers(ipcMain)
  registerTimelineHandlers(ipcMain, () => mainWindowRef)
  registerCaptureHandlers(ipcMain, () => mainWindowRef)
  registerTranscriptHandlers(ipcMain)
  registerThemeHandlers(ipcMain)
  registerHtmlSceneHandlers(ipcMain, () => mainWindowRef)
  registerDiagnosticsHandlers(ipcMain, () => mainWindowRef)
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((err) => reportFatal('Talkie could not finish starting up', err))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// The asset server outlives the window that needed it otherwise, and went on serving every
// project on the machine to anything on loopback for as long as the app was open.
app.on('will-quit', () => {
  void closeAssetServer()
})

// An export renders in browsers of its own, and quitting under one left them running with no
// parent. Cancelling is what closes them, so quitting waits for that first. See exportJob.ts.
let exportsStopped = false
app.on('before-quit', (event) => {
  if (exportsStopped || !exportsRunning()) return
  event.preventDefault()
  exportsStopped = true
  void cancelAllExports().finally(() => app.quit())
})
