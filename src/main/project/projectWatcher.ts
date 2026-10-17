import { watch, readFileSync, type FSWatcher } from 'fs'
import { join } from 'path'
import { contentSignature, writtenSignature } from './atomicWrite'

/**
 * Notices when something other than this process changes the open project.
 *
 * An agent working through the MCP server writes the same files the app reads, from another
 * process, and the editor only read them on opening a project — so a video an agent was building
 * stayed as it had been until the person closed it and opened it again. This watches the project's
 * folder and says when one of its files holds something this process did not write.
 *
 * Only the files the editor shows from. Audio arrives before the transcript that points at it, so a
 * new take is seen when transcript.json changes, and the take is there by then.
 */
export const WATCHED_FILES = ['project.json', 'timeline.json', 'transcript.json', 'versions.json'] as const

/**
 * Long enough for an agent's run of writes — a clip, then its narration — to arrive as one change,
 * short enough to look immediate.
 */
const SETTLE_MS = 250

export interface ProjectWatcher {
  /** Look now rather than wait to be woken — on the window coming forward, say. */
  check: () => void
  /** Take what is on disk as known, without reporting it: the app has just read it all again. */
  accept: () => void
  close: () => void
}

function signatureOf(path: string): string {
  try {
    return contentSignature(readFileSync(path, 'utf-8'))
  } catch {
    return contentSignature(null)
  }
}

export function watchProjectFolder(dir: string, onExternalChange: () => void, settleMs: number = SETTLE_MS): ProjectWatcher {
  const seen = new Map<string, string>()
  const accept = (): void => {
    for (const name of WATCHED_FILES) seen.set(name, signatureOf(join(dir, name)))
  }
  accept()

  const check = (): void => {
    let external = false
    for (const name of WATCHED_FILES) {
      const path = join(dir, name)
      const now = signatureOf(path)
      if (now === seen.get(name)) continue
      seen.set(name, now)
      // The app's own save, seen from outside, is not news.
      if (now !== writtenSignature(path)) external = true
    }
    if (external) onExternalChange()
  }

  let timer: NodeJS.Timeout | null = null
  const soon = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      check()
    }, settleMs)
  }

  let watcher: FSWatcher | null = null
  try {
    // The folder rather than the files: every save is a rename onto the name, which leaves a watch
    // on the old file watching nothing.
    watcher = watch(dir, (_event, name) => {
      if (!name || (WATCHED_FILES as readonly string[]).includes(name.toString())) soon()
    })
    watcher.on('error', () => watcher?.close())
  } catch {
    // A folder that cannot be watched still gets checked when the window comes forward.
  }

  return {
    check,
    accept,
    close: () => {
      if (timer) clearTimeout(timer)
      watcher?.close()
    }
  }
}
