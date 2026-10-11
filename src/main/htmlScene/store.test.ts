import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { createProject, addTimelineItem, readTimeline } from '../project/projectApi'
import { readRevision, sweepUnusedRevisions, writeRevision } from './store'
import { TimelineItemSchema } from '../project/timeline/schema'

let baseDir: string
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'talkie-html-')) })
afterEach(() => rmSync(baseDir, { recursive: true, force: true }))

describe('a scene’s files', () => {
  it('are kept in a folder of their own, and a change makes a new one', () => {
    const { id } = createProject('Demo', baseDir)
    const first = writeRevision(id, { 'index.html': '<h1>One</h1>' }, { baseDir })
    const second = writeRevision(id, { 'index.html': '<h1>Two</h1>' }, { from: first, baseDir })

    expect(dirname(first)).not.toBe(dirname(second))
    expect(readFileSync(first, 'utf-8')).toBe('<h1>One</h1>')
    expect(readFileSync(second, 'utf-8')).toBe('<h1>Two</h1>')
  })

  it('carry over what was not changed, and drop what was removed', () => {
    const { id } = createProject('Demo', baseDir)
    const first = writeRevision(id, { 'index.html': 'x', 'style.css': 'h1{}', 'old.js': '1' }, { baseDir })
    const second = writeRevision(id, { 'index.html': 'y' }, { from: first, remove: ['old.js'], baseDir })

    expect(readRevision(second).map((f) => f.path).sort()).toEqual(['index.html', 'style.css'])
  })

  it('refuse a path that leaves the folder, a type that is not allowed, and too many bytes', () => {
    const { id } = createProject('Demo', baseDir)
    expect(() => writeRevision(id, { '../escape.html': 'x' }, { baseDir })).toThrow(/outside/)
    expect(() => writeRevision(id, { 'index.html': 'x', 'run.sh': 'x' }, { baseDir })).toThrow(/\.sh/)
    expect(() => writeRevision(id, { 'index.html': Buffer.alloc(51 * 1024 * 1024) }, { baseDir })).toThrow(/50 MB/)
  })

  it('need a page to start from', () => {
    const { id } = createProject('Demo', baseDir)
    expect(() => writeRevision(id, { 'style.css': 'h1{}' }, { baseDir })).toThrow(/index\.html/)
  })

  it('are a clip the timeline accepts', () => {
    const { id } = createProject('Demo', baseDir)
    const src = writeRevision(id, { 'index.html': '<p>hi</p>' }, { baseDir })
    expect(TimelineItemSchema.safeParse({ id: 'a', kind: 'html', start: 0, duration: 150, data: { src, title: 'Hi' } }).success).toBe(true)
  })

  it('are swept once nothing points at them', () => {
    const { id } = createProject('Demo', baseDir)
    const kept = writeRevision(id, { 'index.html': 'kept' }, { baseDir })
    const dropped = writeRevision(id, { 'index.html': 'dropped' }, { baseDir })
    addTimelineItem(id, { kind: 'html', start: 0, duration: 150, data: { src: kept, title: 'K' } }, baseDir)

    expect(sweepUnusedRevisions(id, baseDir)).toBe(1)
    expect(existsSync(kept)).toBe(true)
    expect(existsSync(dropped)).toBe(false)
    expect(readTimeline(id, baseDir)).toHaveLength(1)
  })
})
