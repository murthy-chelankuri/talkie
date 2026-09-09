import { appendFileSync, existsSync, readFileSync } from 'fs'

export interface ActionLogEntry {
  t: number
  type: 'click' | 'navigation' | 'input' | 'console.error' | 'annotation'
  selector?: string
  text?: string
  url?: string
  value?: string
  annotation?: 'important' | 'redo' | 'skip'
}

export function appendActionLogEntry(actionLogPath: string, entry: ActionLogEntry): void {
  appendFileSync(actionLogPath, `${JSON.stringify(entry)}\n`, 'utf-8')
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
