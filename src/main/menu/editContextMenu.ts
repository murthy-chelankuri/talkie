import {
  BrowserWindow,
  Menu,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents
} from 'electron'

/**
 * The menu you get when you right-click text.
 *
 * Electron ships no context menu of its own, so until now a right-click in the narration box did
 * nothing at all — which also put the system's own text features out of reach. On macOS those
 * are reached through the Services menu, and Writing Tools (Rewrite, Proofread, Summarise) is
 * among them wherever a selection can be read and replaced. Putting Services on this menu is
 * what makes Apple Intelligence available over narration without this app reimplementing any of
 * it.
 */
export function buildEditContextMenu(
  params: Pick<
    ContextMenuParams,
    'isEditable' | 'selectionText' | 'editFlags' | 'misspelledWord' | 'dictionarySuggestions'
  >,
  platform: NodeJS.Platform = process.platform
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = []
  const hasSelection = params.selectionText.trim().length > 0

  // A misspelling is the most likely reason for opening this menu, so its corrections lead.
  if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      template.push({
        label: suggestion,
        click: (_item, window) => {
          if (window instanceof BrowserWindow) window.webContents.replaceMisspelling(suggestion)
        }
      })
    }
    template.push({ type: 'separator' })
  }

  if (params.isEditable) {
    template.push(
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll' }
    )
  } else if (hasSelection) {
    template.push({ role: 'copy', enabled: params.editFlags.canCopy })
  }

  // Nothing selected in a read-only place is nothing to act on, and an empty menu is worse than
  // none: it appears, says nothing, and has to be dismissed.
  if (template.length === 0) return []

  /**
   * Services is where the system puts what it can do with the selected words — Writing Tools
   * among them. It is worth showing only when there are words: with no selection the submenu is
   * empty, which reads as a broken menu rather than an unavailable feature.
   */
  if (platform === 'darwin' && hasSelection) {
    template.push({ type: 'separator' }, { role: 'services' })
  }

  return template
}

/** Give a window's text the menu above, for as long as that window lives. */
export function registerEditContextMenu(webContents: WebContents): void {
  webContents.on('context-menu', (_event, params) => {
    const template = buildEditContextMenu(params)
    if (template.length === 0) return

    Menu.buildFromTemplate(template).popup({
      window: BrowserWindow.fromWebContents(webContents) ?? undefined
    })
  })
}
