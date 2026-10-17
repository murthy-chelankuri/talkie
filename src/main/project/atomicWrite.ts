import { writeFileSync, renameSync } from 'fs'
import { createHash } from 'crypto'
import { dirname, join, resolve } from 'path'

/**
 * What this process last put in each file, as a hash — so the watcher on an open project can tell
 * the app's own saves from an agent's (projectWatcher.ts). Without it every autosave would read as
 * someone else's change and reload the editor under the person typing.
 */
const written = new Map<string, string>()

export function contentSignature(text: string | null): string {
  return text === null ? 'absent' : createHash('sha1').update(text).digest('hex')
}

/** The signature of what this process last wrote at `filePath`, or undefined if it never has. */
export function writtenSignature(filePath: string): string | undefined {
  return written.get(resolve(filePath))
}

/** For a file this process removed: its absence is this process's doing too. */
export function noteRemoved(filePath: string): void {
  written.set(resolve(filePath), contentSignature(null))
}

/**
 * `mode` is applied to the temporary file, which is the one that survives the rename — so a
 * file written this way is created with the permissions asked for rather than widened first and
 * narrowed afterwards.
 */
export function writeJsonAtomic(filePath: string, data: unknown, mode?: number): void {
  const tempPath = join(
    dirname(filePath),
    `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  )

  const text = JSON.stringify(data, null, 2)
  writeFileSync(tempPath, text, mode === undefined ? 'utf-8' : { encoding: 'utf-8', mode })
  // Noted before the rename, so a watcher woken by the rename already knows whose it was.
  written.set(resolve(filePath), contentSignature(text))
  renameSync(tempPath, filePath)
}
