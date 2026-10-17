import { homedir } from 'os'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { findProjectDir } from './paths'
import { noteRemoved, writeJsonAtomic } from './atomicWrite'

// A project's editable state is a few small JSON files, so the simplest correct undo is to keep
// copies of them rather than teach every operation how to reverse itself. Audio files are not
// included: re-narrating overwrites a recording, and undo restores the text around it, not the
// voice.
interface Snapshot {
  timeline: unknown
  transcript: unknown
  /** Which scenes each version leaves out; null where the project has never had a version. */
  versions: unknown
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
      transcript: JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf-8')),
      versions: existsSync(join(dir, 'versions.json')) ? JSON.parse(readFileSync(join(dir, 'versions.json'), 'utf-8')) : null
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
  // Leaving a scene out is an edit like any other, so undo puts it back — and undoing the first
  // version ever made leaves the project as it was, with no versions file at all.
  if (snapshot.versions === null) {
    rmSync(join(dir, 'versions.json'), { force: true })
    noteRemoved(join(dir, 'versions.json'))
  } else writeJsonAtomic(join(dir, 'versions.json'), snapshot.versions)
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
