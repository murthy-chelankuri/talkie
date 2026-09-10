import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject, addTimelineItem, readTimeline } from '../project/projectApi'
import { startRecordingSession } from './recordSession'
import { importRecordedSession } from './importRecordedSession'

describe('importRecordedSession (real Playwright recording)', () => {
  it('appends the recorded video to the timeline after any existing items', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-import-session-test-'))
    const project = createProject('Import Session', baseDir)
    addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)

    const fixtureUrl = `file://${join(__dirname, 'fixtures', 'recording-test-page.html')}`
    const session = await startRecordingSession(project.id, fixtureUrl, baseDir)
    await session.page.click('#test-button')
    await session.page.waitForTimeout(300)
    const result = await session.stop()

    const item = await importRecordedSession(project.id, result.videoPath, baseDir)

    expect(item.kind).toBe('video')
    expect((item.data as { src: string }).src).toBe(result.videoPath)
    // Appended after the pre-existing 90-frame image item.
    expect(item.start).toBe(90)
    expect(item.duration).toBeGreaterThan(0)

    const timeline = readTimeline(project.id, baseDir)
    expect(timeline).toHaveLength(2)
    expect(timeline[1].id).toBe(item.id)

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)

  it('trims the blank lead-in and shortens the clip by the trimmed amount', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-import-trim-test-'))
    const project = createProject('Import Trim', baseDir)

    const fixtureUrl = `file://${join(__dirname, 'fixtures', 'recording-test-page.html')}`
    const session = await startRecordingSession(project.id, fixtureUrl, baseDir)
    await session.page.waitForTimeout(2000)
    const recording = await session.stop()

    const untrimmed = await importRecordedSession(project.id, recording.videoPath, baseDir)
    const trimmed = await importRecordedSession(project.id, recording.videoPath, baseDir, {
      // A full second of blank page before the site appeared.
      contentStartMs: 1000
    })

    expect((untrimmed.data as { trimBefore?: number }).trimBefore).toBeUndefined()
    expect((trimmed.data as { trimBefore?: number }).trimBefore).toBe(30)
    expect(trimmed.duration).toBe(untrimmed.duration - 30)

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)

  it('ignores a lead-in that would swallow the whole clip', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-import-trim-cap-test-'))
    const project = createProject('Import Trim Cap', baseDir)

    const fixtureUrl = `file://${join(__dirname, 'fixtures', 'recording-test-page.html')}`
    const session = await startRecordingSession(project.id, fixtureUrl, baseDir)
    await session.page.waitForTimeout(1000)
    const recording = await session.stop()

    const item = await importRecordedSession(project.id, recording.videoPath, baseDir, {
      contentStartMs: 60_000
    })

    expect((item.data as { trimBefore?: number }).trimBefore).toBeUndefined()
    expect(item.duration).toBeGreaterThan(0)

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)
})
