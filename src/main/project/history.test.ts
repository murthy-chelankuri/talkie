import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createProject,
  addTimelineItem,
  readTimeline,
  readTranscript,
  addTranscriptSegment,
  deleteTimelineItem
} from './projectApi'
import { clearHistory, historyState, redo, undo, withHistory } from './history'

describe('project history', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-history-test-'))
    clearHistory()
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
    clearHistory()
  })

  it('has nothing to undo on a project nobody has edited', () => {
    const project = createProject('Untouched', baseDir)
    expect(historyState(project.id)).toEqual({ canUndo: false, canRedo: false })
  })

  it('puts back a clip that was removed', () => {
    const project = createProject('Undo Delete', baseDir)
    const keep = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const doomed = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)

    withHistory(project.id, () => deleteTimelineItem(project.id, doomed.id, baseDir), baseDir)
    expect(readTimeline(project.id, baseDir).map((i) => i.id)).toEqual([keep.id])

    undo(project.id, baseDir)

    expect(readTimeline(project.id, baseDir).map((i) => i.id)).toEqual([keep.id, doomed.id])
  })

  it('brings back the narration that went with the clip', () => {
    const project = createProject('Undo Narration', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Some words', timelineItemId: item.id }, baseDir)

    withHistory(project.id, () => deleteTimelineItem(project.id, item.id, baseDir), baseDir)
    expect(readTranscript(project.id, baseDir)).toEqual([])

    undo(project.id, baseDir)

    expect(readTranscript(project.id, baseDir).map((s) => s.id)).toEqual([segment.id])
  })

  it('redoes what was undone', () => {
    const project = createProject('Redo', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)

    withHistory(project.id, () => deleteTimelineItem(project.id, item.id, baseDir), baseDir)
    undo(project.id, baseDir)
    expect(readTimeline(project.id, baseDir)).toHaveLength(1)

    redo(project.id, baseDir)

    expect(readTimeline(project.id, baseDir)).toHaveLength(0)
  })

  it('steps back one action at a time', () => {
    const project = createProject('Two Steps', baseDir)
    const first = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const second = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)

    withHistory(project.id, () => deleteTimelineItem(project.id, second.id, baseDir), baseDir)
    withHistory(project.id, () => deleteTimelineItem(project.id, first.id, baseDir), baseDir)
    expect(readTimeline(project.id, baseDir)).toHaveLength(0)

    undo(project.id, baseDir)
    expect(readTimeline(project.id, baseDir).map((i) => i.id)).toEqual([first.id])

    undo(project.id, baseDir)
    expect(readTimeline(project.id, baseDir).map((i) => i.id)).toEqual([first.id, second.id])
  })

  it('counts an action as one step however many writes it makes', () => {
    const project = createProject('One Step', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    addTranscriptSegment(project.id, { text: 'Words', timelineItemId: item.id }, baseDir)

    // Deleting a clip writes both the timeline and the transcript.
    withHistory(project.id, () => deleteTimelineItem(project.id, item.id, baseDir), baseDir)
    undo(project.id, baseDir)

    expect(readTimeline(project.id, baseDir)).toHaveLength(1)
    expect(readTranscript(project.id, baseDir)).toHaveLength(1)
    expect(historyState(project.id).canUndo).toBe(false)
  })

  it('drops the redo trail once a new edit is made', () => {
    const project = createProject('Redo Trail', baseDir)
    const first = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const second = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)

    withHistory(project.id, () => deleteTimelineItem(project.id, second.id, baseDir), baseDir)
    undo(project.id, baseDir)
    expect(historyState(project.id).canRedo).toBe(true)

    withHistory(project.id, () => deleteTimelineItem(project.id, first.id, baseDir), baseDir)

    expect(historyState(project.id).canRedo).toBe(false)
  })

  it('reports what is available as it goes', () => {
    const project = createProject('State', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)

    withHistory(project.id, () => deleteTimelineItem(project.id, item.id, baseDir), baseDir)
    expect(historyState(project.id)).toEqual({ canUndo: true, canRedo: false })

    expect(undo(project.id, baseDir)).toEqual({ canUndo: false, canRedo: true })
    expect(redo(project.id, baseDir)).toEqual({ canUndo: true, canRedo: false })
  })

  it('does nothing when there is nothing left to undo', () => {
    const project = createProject('Nothing', baseDir)
    addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)

    expect(undo(project.id, baseDir)).toEqual({ canUndo: false, canRedo: false })
    expect(readTimeline(project.id, baseDir)).toHaveLength(1)
  })

  it('keeps each project history to itself', () => {
    const a = createProject('Project A', baseDir)
    const b = createProject('Project B', baseDir)
    const itemA = addTimelineItem(a.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)

    withHistory(a.id, () => deleteTimelineItem(a.id, itemA.id, baseDir), baseDir)

    expect(historyState(a.id).canUndo).toBe(true)
    expect(historyState(b.id).canUndo).toBe(false)
  })
})
