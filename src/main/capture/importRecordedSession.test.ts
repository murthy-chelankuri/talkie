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
})
