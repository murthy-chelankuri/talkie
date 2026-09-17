import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

let toolbarWindow: BrowserWindow | null = null

/**
 * The two shapes this window takes.
 *
 * Setting up is an address and a button; recording is a clock, three notes and a way out. One
 * size that held both left whichever state was showing either cramped or mostly empty, and an
 * always-on-top window has no room to be either. Main resizes it rather than the page asking to
 * be resized, so the toolbar's bridge stays the five calls it has.
 */
const SIZES = {
  setup: { width: 440, height: 208 },
  recording: { width: 440, height: 336 }
} as const

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
    ...SIZES.setup,
    // Measured as the page rather than the frame, so the layout and the window agree.
    useContentSize: true,
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

/** Give the toolbar the room the state it is in needs, keeping the corner it was left in. */
export function setToolbarMode(mode: keyof typeof SIZES): void {
  if (!toolbarWindow || toolbarWindow.isDestroyed()) return

  // Content bounds, not `getPosition()`: that returns where the frame is, and handing a frame
  // position back as a content position walks the window up by the height of its title bar
  // every time the mode changes.
  const current = toolbarWindow.getContentBounds()
  const { width, height } = SIZES[mode]

  // Growing downwards off the bottom of the screen would put Stop where it cannot be pressed,
  // and this window is deliberately not resizable, so there would be no way back.
  const { workArea } = screen.getDisplayMatching(current)
  const y = Math.min(current.y, workArea.y + workArea.height - height)

  toolbarWindow.setContentBounds({ x: current.x, y: Math.max(workArea.y, y), width, height })
}

/**
 * Tell the toolbar what the automatic walk is doing.
 *
 * Without this the user watches a browser move on its own with no idea whether it is showing
 * them round or stuck on a page — and the one control they have is stop, which they should not
 * have to guess about pressing.
 */
export function setToolbarStatus(status: string): void {
  if (!toolbarWindow || toolbarWindow.isDestroyed()) return
  toolbarWindow.webContents.send('project:capture:exploring', status)
}
