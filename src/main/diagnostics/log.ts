import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { ROOT_NAME } from '../project/migrateStorageRoot'

/**
 * Somewhere a packaged app can say what went wrong.
 *
 * Every failure in the recording pipeline was reported with `console.error`, which is a good
 * answer in a checkout and no answer at all once the app is packaged: there is no terminal
 * behind an app opened from Finder, so the message goes nowhere. That is how a recording could
 * come back holding only its first page, with a cause already written down and thrown away.
 *
 * The distinction matters most exactly where the code carries on rather than failing. A stitch
 * that falls back to one page's footage, or a page whose video could not be kept, both leave the
 * user with a shorter recording and no error — so the log is the only thing that can tell them
 * why, and it has to survive the app being closed.
 */
export function logsDir(baseDir: string = homedir()): string {
  return join(baseDir, ROOT_NAME, 'logs')
}

export function logPath(baseDir: string = homedir()): string {
  return join(logsDir(baseDir), 'talkie.log')
}

/** Past this the log is rolled over, so a long-running install cannot fill a disk. */
const MAX_BYTES = 2 * 1024 * 1024

function rollIfLarge(path: string): void {
  try {
    if (statSync(path).size > MAX_BYTES) renameSync(path, `${path}.1`)
  } catch {
    // No log yet, or it cannot be rolled. Either way the append below is still worth trying.
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`
  return String(err)
}

/**
 * Write a failure down, and say it on the console too.
 *
 * Both, deliberately: the console is what a developer is already watching, and the file is the
 * only thing a packaged install has. Never throws — a logger that can fail the operation it is
 * reporting on would be worse than no logger.
 */
export function logFailure(what: string, err?: unknown, baseDir: string = homedir()): void {
  const line = err === undefined ? what : `${what}: ${describe(err)}`
  console.error(line)

  try {
    const dir = logsDir(baseDir)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'talkie.log')
    rollIfLarge(path)
    appendFileSync(path, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // The console line above has already been written; losing the file copy is not worth
    // failing a recording over.
  }
}
