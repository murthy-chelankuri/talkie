import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs'

export interface ActionLogEntry {
  t: number
  type: 'click' | 'navigation' | 'input' | 'console.error' | 'annotation'
  selector?: string
  text?: string
  url?: string
  value?: string
  annotation?: 'important' | 'redo' | 'skip'
  /**
   * Where a click landed, and how big the thing was, as shares of the viewport.
   *
   * Kept as shares rather than pixels so they survive a recording being rendered at a different
   * size — and so the export can put the viewer's eye where the click was, which is the one
   * thing a screen recording cannot say for itself.
   */
  x?: number
  y?: number
  w?: number
  h?: number
}

export function appendActionLogEntry(actionLogPath: string, entry: ActionLogEntry): void {
  appendFileSync(actionLogPath, `${JSON.stringify(entry)}\n`, 'utf-8')
}

export function writeActionLog(actionLogPath: string, entries: ActionLogEntry[]): void {
  writeFileSync(actionLogPath, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''), 'utf-8')
}

export function readActionLog(actionLogPath: string): ActionLogEntry[] {
  if (!existsSync(actionLogPath)) return []

  const raw = readFileSync(actionLogPath, 'utf-8')
  const entries: ActionLogEntry[] = []

  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      entries.push(JSON.parse(line))
    } catch (err) {
      console.error('Skipping malformed action log line:', err)
    }
  }

  return entries
}
