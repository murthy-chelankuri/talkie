import type { IpcMain, WebContents } from 'electron'
import { logEvent, logFailure } from './log'

/**
 * Every failure of a window's request written down on its way back.
 *
 * A handler that throws is shown in the window, if anywhere, and gone once that is dismissed; the
 * log is how a report can say which request failed and how. Installed before any handler is, so
 * none can be registered around it. The channel and the error, never the arguments — those carry
 * narration and scenes.
 */
export function logHandlerFailures(ipc: IpcMain): void {
  const handle = ipc.handle.bind(ipc)
  ipc.handle = (channel, listener) =>
    handle(channel, async (event, ...args) => {
      try {
        return await listener(event, ...args)
      } catch (err) {
        logFailure(`${channel} failed`, err)
        throw err
      }
    })
}

/**
 * Errors a window prints, which otherwise live only in its developer tools. The window's own
 * messages only — a recording's browser is a separate program, and an HTML scene's page is the
 * person's work.
 */
export function logWindowErrors(contents: WebContents): void {
  contents.on('console-message', (details) => {
    if (details.level !== 'error') return
    // An HTML scene plays in a frame of the window, and what its page prints is about its page.
    if (details.frame && details.frame !== contents.mainFrame) return
    logEvent(`${details.message}${details.sourceId ? ` (${details.sourceId.split('/').pop()}:${details.lineNumber})` : ''}`, 'window')
  })
}
