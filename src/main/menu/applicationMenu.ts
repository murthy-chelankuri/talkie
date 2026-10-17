import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/**
 * Everything the menu can ask the window to do.
 *
 * The menu names actions rather than reaching into the app: each one is sent to the renderer,
 * which already owns these operations and knows what is selected. Keeping the list here as a
 * type means a menu item cannot name something nothing listens for.
 */
export type MenuAction =
  | 'new-project'
  | 'open-project'
  | 'import-image'
  | 'import-deck'
  | 'add-scene'
  | 'record-session'
  | 'export-video'
  | 'draft-all'
  | 'speak-all'
  | 'project-context'
  | 'reload-project'
  | 'settings'
  | 'licences'
  | 'report-problem'
  | 'undo'
  | 'redo'

/** What the window is showing, so items that cannot apply are visibly unavailable. */
export interface MenuState {
  /** False on the project list, where there is nothing to import into or export. */
  projectOpen: boolean
  canUndo: boolean
  canRedo: boolean
}

export const INITIAL_MENU_STATE: MenuState = { projectOpen: false, canUndo: false, canRedo: false }

const REPOSITORY = 'https://github.com/murthy-chelankuri/talkie'

/**
 * The menu, as a plain template.
 *
 * Separated from installing it so the shape can be tested without an Electron window: what
 * matters here is which items exist, what they are called, and when they are available.
 */
export function buildMenuTemplate(
  state: MenuState,
  send: (action: MenuAction) => void,
  platform: NodeJS.Platform = process.platform
): MenuItemConstructorOptions[] {
  const isMac = platform === 'darwin'
  const item = (
    label: string,
    action: MenuAction,
    accelerator?: string,
    enabled = true
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    enabled,
    click: () => send(action)
  })

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            item('Settings…', 'settings', 'CmdOrCtrl+,'),
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }
      ]
    : []

  return [
    ...appMenu,
    {
      label: 'File',
      submenu: [
        item('New Project…', 'new-project', 'CmdOrCtrl+N'),
        item('Open Project…', 'open-project', 'CmdOrCtrl+O'),
        { type: 'separator' },
        // Everything from here needs somewhere to put what it makes.
        item('Record a Session…', 'record-session', 'CmdOrCtrl+R', state.projectOpen),
        item('Add a Scene…', 'add-scene', 'CmdOrCtrl+Shift+N', state.projectOpen),
        item('Import an Image…', 'import-image', 'CmdOrCtrl+I', state.projectOpen),
        item('Import a Slide Deck…', 'import-deck', 'CmdOrCtrl+Shift+I', state.projectOpen),
        { type: 'separator' },
        item('Export Video…', 'export-video', 'CmdOrCtrl+E', state.projectOpen),
        { type: 'separator' },
        ...(isMac
          ? [{ role: 'close' as const }]
          : [item('Settings…', 'settings', 'CmdOrCtrl+,'), { type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        // Routed to the renderer rather than given Electron's `undo` role: on the timeline this
        // steps the project back, and in a text field it has to remain the field's own undo. An
        // accelerator on a menu item swallows the keystroke before the window sees it, so the
        // window is told about the keystroke instead of being bypassed by it.
        item('Undo', 'undo', 'CmdOrCtrl+Z', state.canUndo),
        item('Redo', 'redo', 'CmdOrCtrl+Shift+Z', state.canRedo),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        ...(isMac
          ? [{ type: 'separator' as const }, { label: 'Speech', submenu: [{ role: 'startSpeaking' as const }, { role: 'stopSpeaking' as const }] }]
          : [])
      ]
    },
    {
      label: 'Project',
      submenu: [
        item('Write All Narration', 'draft-all', 'CmdOrCtrl+Shift+D', state.projectOpen),
        item('Speak All Clips', 'speak-all', 'CmdOrCtrl+Shift+S', state.projectOpen),
        { type: 'separator' },
        item('About This Project…', 'project-context', undefined, state.projectOpen),
        { type: 'separator' },
        // Picks up what an agent changed over MCP. The window watches for that too; this is for
        // when you would rather not wait or the watch missed it.
        item('Reload from Disk', 'reload-project', 'Alt+CmdOrCtrl+R', state.projectOpen)
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: 'Window', role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        item('Licences', 'licences'),
        { type: 'separator' },
        {
          label: 'Talkie on GitHub',
          click: () => void shell.openExternal(REPOSITORY)
        },
        // Through the window, which gathers what a report needs first: a blank issue was all this
        // once opened, and the details that would have found the cause had to be asked for.
        item('Report a Problem…', 'report-problem')
      ]
    }
  ]
}

/**
 * Builds the menu and puts it in place, replacing whatever was there.
 *
 * Called again whenever the state it depends on changes, because a menu item's enabled flag is
 * fixed at the moment it is built — an Export item that stays available on the project list is
 * worse than no menu item at all.
 */
export function installApplicationMenu(getWindow: () => BrowserWindow | null, state: MenuState): void {
  const send = (action: MenuAction): void => {
    getWindow()?.webContents.send('menu:action', action)
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(state, send)))
}
