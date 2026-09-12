import {
  BrowserWindow,
  Menu,
  dialog,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents
} from 'electron'
import { REWRITE_LABELS, REWRITE_STYLES, rewriteText, type RewriteStyle } from '../agent/rewriteText'

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
  platform: NodeJS.Platform = process.platform,
  onRewrite?: (style: RewriteStyle) => void
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

  /**
   * Rewriting comes first because it is the reason to open this menu on narration, and because
   * it is the one thing here the system will not do for us — Writing Tools is attached by AppKit
   * to its own text views, and this is a web view with a menu built in JavaScript.
   */
  if (params.isEditable && hasSelection && onRewrite) {
    template.push(
      {
        label: 'Rewrite',
        submenu: REWRITE_STYLES.map((style) => ({
          label: REWRITE_LABELS[style],
          click: () => onRewrite(style)
        }))
      },
      { type: 'separator' }
    )
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

/**
 * How long the clip under this field runs, so "fit the clip" has a length to write to.
 *
 * Read off the focused element rather than tracked in the main process: the field itself is the
 * only thing that knows which clip it belongs to, and it already knows.
 */
async function focusedClipSeconds(webContents: WebContents): Promise<number | undefined> {
  try {
    const seconds = await webContents.executeJavaScript(
      'Number(document.activeElement?.dataset?.clipSeconds) || null',
      true
    )
    return typeof seconds === 'number' && seconds > 0 ? seconds : undefined
  } catch {
    return undefined
  }
}

/**
 * Rewrite what is selected and put the answer in its place.
 *
 * `insertText` replaces the selection, so the field's own undo still holds the original — a
 * rewrite someone dislikes is one Cmd-Z away rather than something to retype.
 */
async function applyRewrite(
  webContents: WebContents,
  style: RewriteStyle,
  text: string
): Promise<void> {
  const window = BrowserWindow.fromWebContents(webContents) ?? undefined

  try {
    const rewritten = await rewriteText({ text, style, seconds: await focusedClipSeconds(webContents) })
    if (webContents.isDestroyed()) return
    webContents.insertText(rewritten)
  } catch (err) {
    if (webContents.isDestroyed()) return

    const message = err instanceof Error ? err.message : String(err)
    const options = { type: 'warning' as const, title: 'Could not rewrite that', message }
    if (window) dialog.showMessageBox(window, options)
    else dialog.showMessageBox(options)
  }
}

/** Give a window's text the menu above, for as long as that window lives. */
export function registerEditContextMenu(webContents: WebContents): void {
  webContents.on('context-menu', (_event, params) => {
    const template = buildEditContextMenu(params, process.platform, (style) => {
      void applyRewrite(webContents, style, params.selectionText)
    })
    if (template.length === 0) return

    Menu.buildFromTemplate(template).popup({
      window: BrowserWindow.fromWebContents(webContents) ?? undefined
    })
  })
}
