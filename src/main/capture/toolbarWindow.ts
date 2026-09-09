import { BrowserWindow } from 'electron'
import { join } from 'path'

let toolbarWindow: BrowserWindow | null = null

export function openToolbarWindow(projectId: string): BrowserWindow {
  toolbarWindow = new BrowserWindow({
    width: 360,
    height: 160,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  toolbarWindow.loadFile(join(process.cwd(), 'src/main/capture/toolbar.html'), { query: { projectId } })

  toolbarWindow.on('closed', () => {
    toolbarWindow = null
  })

  return toolbarWindow
}
