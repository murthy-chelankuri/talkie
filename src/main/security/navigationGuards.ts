import { shell, type WebContents } from 'electron'

/**
 * Where a window of this app is allowed to go, which is nowhere.
 *
 * Every window here shows markup this app built — the editor, and the recording toolbar. None of
 * them has a reason to navigate anywhere else, so anything that tries is either a mistake or
 * something that got in: a link in narration text, a redirect from an embedded resource, a
 * `window.open` from injected script. Left unguarded, a renderer that navigated to a remote page
 * would keep the preload bridge, and that bridge reads settings and writes files.
 *
 * Links meant for a person still work — they open in the browser, where a web page belongs and
 * where it has none of this app's privileges.
 */

/** Schemes a window of ours legitimately runs on: the built files, and the dev server. */
function isOwnPage(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol === 'file:') return true
    // electron-vite serves the renderer from localhost while developing.
    return (protocol === 'http:' || protocol === 'https:') && (hostname === 'localhost' || hostname === '127.0.0.1')
  } catch {
    return false
  }
}

/** Only these are worth handing to the operating system; anything else is silently refused. */
function isSafeExternal(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

export function applyNavigationGuards(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (isOwnPage(url)) return

    event.preventDefault()
    if (isSafeExternal(url)) void shell.openExternal(url)
  })

  // A new window is never the answer here: this app has no flow that wants one, and the default
  // behaviour would give whatever opened it a renderer of its own.
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // A renderer cannot attach a webview if none is enabled, but the default can change and this
  // costs nothing to state.
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}
