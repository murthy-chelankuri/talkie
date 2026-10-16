import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'fs'
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
export function logsDir(baseDir: string = logHome()): string {
  return join(baseDir, ROOT_NAME, 'logs')
}

export function logPath(baseDir: string = logHome()): string {
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
 * Which process wrote a line. The app, the MCP server and the Kokoro worker all write the one file,
 * and a failure reported from an agent's session reads very differently from one in the window.
 */
export type LogSource = 'app' | 'window' | 'mcp' | 'kokoro'

let source: LogSource = 'app'
let home: string | null = null

/**
 * Where the log lives and who is writing it, set once as a process starts. The MCP server is
 * told its home by TALKIE_HOME, not the real one; the tests point it at a folder of their own
 * (TALKIE_LOG_HOME) so a suite run never writes into the person's log.
 */
export function configureLog(options: { source?: LogSource; home?: string }): void {
  if (options.source) source = options.source
  if (options.home) home = options.home
}

export function logHome(): string {
  return home ?? process.env.TALKIE_LOG_HOME ?? homedir()
}

function append(line: string, baseDir: string, from: LogSource = source): void {
  try {
    const dir = logsDir(baseDir)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'talkie.log')
    rollIfLarge(path)
    const stamp = new Date().toISOString()
    appendFileSync(path, line.split('\n').map((each) => `${stamp} [${from}] ${each}`).join('\n') + '\n')
  } catch {
    // Losing the file copy is not worth failing whatever is being reported on.
  }
}

/**
 * Write down something worth knowing that is not a failure — a process starting, and what it is.
 * Never the person's words: no narration, no tool arguments, nothing out of a project.
 */
export function logEvent(what: string, from?: LogSource, baseDir: string = logHome()): void {
  append(what, baseDir, from)
}

/** The end of the log, older file first, for a report or an agent asking what went wrong. */
export function readLogTail(lines: number, baseDir: string = logHome()): string {
  const path = logPath(baseDir)
  const text = [`${path}.1`, path]
    .filter((each) => existsSync(each))
    .map((each) => readFileSync(each, 'utf8'))
    .join('')
  return text.split('\n').filter(Boolean).slice(-lines).join('\n')
}

/**
 * Write a failure down, and say it on the console too.
 *
 * Both, deliberately: the console is what a developer is already watching, and the file is the
 * only thing a packaged install has. Never throws — a logger that can fail the operation it is
 * reporting on would be worse than no logger.
 */
export function logFailure(what: string, err?: unknown, baseDir: string = logHome(), from?: LogSource): void {
  const line = err === undefined ? what : `${what}: ${describe(err)}`
  console.error(line)
  // The console line above has already been written; losing the file copy is not worth failing a
  // recording over, which is why append never throws.
  append(line, baseDir, from)
}
