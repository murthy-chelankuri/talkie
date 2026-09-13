import { BrowserWindow } from 'electron'
import { join } from 'path'

let toolbarWindow: BrowserWindow | null = null

/**
 * The small always-on-top window that drives a recording.
 *
 * It ran with node integration on and context isolation off, which is the combination that makes
 * a renderer as powerful as the main process. Four buttons and a URL field do not need that, so
 * it is now an ordinary isolated window with a preload exposing only the capture calls.
 *
 * It also loaded through `process.cwd()`, which is the directory the app happened to be launched
 * from — for anything started from Finder that is `/`, and `src/` is not inside a packaged build
 * at all. Recording therefore worked when run from source and silently failed when packaged. The
 * markup is now built like any other window and found relative to this file.
 */
export function openToolbarWindow(projectId: string, onClosed: () => void): BrowserWindow {
  if (toolbarWindow) {
    toolbarWindow.focus()
    return toolbarWindow
  }

  toolbarWindow = new BrowserWindow({
    width: 420,
    height: 150,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    title: 'Recording',
    webPreferences: {
      preload: join(__dirname, '../preload/toolbar.cjs'),
      // Defaults, stated because this window is where they were previously turned off.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) {
    void toolbarWindow.loadURL(`${devServer}/toolbar.html?projectId=${encodeURIComponent(projectId)}`)
  } else {
    void toolbarWindow.loadFile(join(__dirname, '../renderer/toolbar.html'), {
      query: { projectId }
    })
  }

  toolbarWindow.once('ready-to-show', () => toolbarWindow?.show())

  toolbarWindow.on('closed', () => {
    toolbarWindow = null
    onClosed()
  })

  return toolbarWindow
}
