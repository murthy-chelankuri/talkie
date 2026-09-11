import { homedir } from 'os'
import { readFileSync } from 'fs'
import { join } from 'path'
import { findProjectDir } from './paths'
import { writeJsonAtomic } from './atomicWrite'

// A project's editable state is two small JSON files, so the simplest correct undo is to keep
// copies of them rather than teach every operation how to reverse itself. Audio files are not
// included: re-narrating overwrites a recording, and undo restores the text around it, not the
// voice.
interface Snapshot {
  timeline: unknown
  transcript: unknown
}

interface History {
  past: Snapshot[]
  future: Snapshot[]
}

const HISTORY_LIMIT = 50
const histories = new Map<string, History>()

function historyFor(projectId: string): History {
  const existing = histories.get(projectId)
  if (existing) return existing
  const created: History = { past: [], future: [] }
  histories.set(projectId, created)
  return created
}

function readSnapshot(projectId: string, baseDir: string): Snapshot | null {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) return null
  try {
    return {
      timeline: JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf-8')),
      transcript: JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf-8'))
    }
  } catch (err) {
    console.error(`Could not snapshot project ${projectId} for undo:`, err)
    return null
  }
}

function writeSnapshot(projectId: string, snapshot: Snapshot, baseDir: string): void {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) return
  writeJsonAtomic(join(dir, 'timeline.json'), snapshot.timeline)
  writeJsonAtomic(join(dir, 'transcript.json'), snapshot.transcript)
}

// Run one user-level action, remembering the state it started from. Nested writes inside the
// action share the single snapshot, so undo steps back by whole actions rather than by write.
export function withHistory<T>(projectId: string, action: () => T, baseDir: string = homedir()): T {
  const before = readSnapshot(projectId, baseDir)
  const result = action()

  if (before) {
    const history = historyFor(projectId)
    history.past.push(before)
    if (history.past.length > HISTORY_LIMIT) history.past.shift()
    history.future.length = 0
  }
  return result
}

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
}

export function historyState(projectId: string): HistoryState {
  const history = histories.get(projectId)
  return { canUndo: (history?.past.length ?? 0) > 0, canRedo: (history?.future.length ?? 0) > 0 }
}

export function undo(projectId: string, baseDir: string = homedir()): HistoryState {
  const history = historyFor(projectId)
  const previous = history.past.pop()
  if (!previous) return historyState(projectId)

  const current = readSnapshot(projectId, baseDir)
  if (current) history.future.push(current)
  writeSnapshot(projectId, previous, baseDir)
  return historyState(projectId)
}

export function redo(projectId: string, baseDir: string = homedir()): HistoryState {
  const history = historyFor(projectId)
  const next = history.future.pop()
  if (!next) return historyState(projectId)

  const current = readSnapshot(projectId, baseDir)
  if (current) history.past.push(current)
  writeSnapshot(projectId, next, baseDir)
  return historyState(projectId)
}

export function clearHistory(projectId?: string): void {
  if (projectId) histories.delete(projectId)
  else histories.clear()
}
