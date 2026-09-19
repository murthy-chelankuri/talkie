import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject, addTimelineItem, readTimeline } from '../project/projectApi'
import { startRecordingSession } from './recordSession'
import { importRecordedSession, leadInToDrop } from './importRecordedSession'

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

    // Short enough to be one scene, so this still describes a single clip landing on the
    // timeline. Splitting is covered in sceneBoundaries.test.ts and recordedScenes.test.ts.
    const [item] = await importRecordedSession(project.id, result, baseDir)

    expect(item.kind).toBe('video')
    // The item points at the stitched, seekable copy rather than at a raw page capture.
    expect((item.data as { src: string }).src).toBe(
      join(result.clips[0].videoPath, '..', 'video.mp4')
    )
    // Appended after the pre-existing 90-frame image item.
    expect(item.start).toBe(90)
    expect(item.duration).toBeGreaterThan(0)

    const timeline = readTimeline(project.id, baseDir)
    expect(timeline).toHaveLength(2)
    expect(timeline[1].id).toBe(item.id)

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)

  it('takes the trimmed lead-in off the front, leaving the rest of the clip intact', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-import-trim-test-'))
    const project = createProject('Import Trim', baseDir)

    const fixtureUrl = `file://${join(__dirname, 'fixtures', 'recording-test-page.html')}`
    const session = await startRecordingSession(project.id, fixtureUrl, baseDir)
    await session.page.waitForTimeout(5000)
    const recording = await session.stop()

    const [untrimmed] = await importRecordedSession(project.id, { clips: recording.clips }, baseDir)
    const [trimmed] = await importRecordedSession(
      project.id,
      // A full second of blank page before the site appeared.
      { clips: recording.clips, contentStartMs: 1000 },
      baseDir
    )

    expect((untrimmed.data as { trimBefore?: number }).trimBefore).toBeUndefined()

    // Asserted as a relationship rather than a frame count. How long a real capture comes out
    // is up to the machine — pinning this to 30 frames made it a test of how busy the machine
    // was, which it failed twice.
    const dropped = (trimmed.data as { trimBefore?: number }).trimBefore ?? 0
    expect(dropped).toBe(leadInToDrop(untrimmed.duration, 1000))
    expect(trimmed.duration + dropped).toBe(untrimmed.duration)

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)

  it('ignores a lead-in that would swallow the whole clip', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-import-trim-cap-test-'))
    const project = createProject('Import Trim Cap', baseDir)

    const fixtureUrl = `file://${join(__dirname, 'fixtures', 'recording-test-page.html')}`
    const session = await startRecordingSession(project.id, fixtureUrl, baseDir)
    await session.page.waitForTimeout(1000)
    const recording = await session.stop()

    const [item] = await importRecordedSession(
      project.id,
      { clips: recording.clips, contentStartMs: 60_000 },
      baseDir
    )

    expect((item.data as { trimBefore?: number }).trimBefore).toBeUndefined()
    expect(item.duration).toBeGreaterThan(0)

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)
})

describe('deciding how much of the lead-in to drop', () => {
  it('drops what was measured when there is clip left over', () => {
    expect(leadInToDrop(300, 1000)).toBe(30)
  })

  it('drops nothing when nothing was measured', () => {
    expect(leadInToDrop(300, 0)).toBe(0)
    expect(leadInToDrop(300, undefined)).toBe(0)
  })

  it('refuses a lead-in that would leave less than a second of clip', () => {
    // A lead-in measured as most of the recording is a measurement that has gone wrong, and
    // trimming on it would leave a clip of nothing.
    expect(leadInToDrop(60, 1500)).toBe(0)
    expect(leadInToDrop(300, 60_000)).toBe(0)
  })

  it('keeps a trim that leaves exactly a second, which is the edge it is drawn at', () => {
    expect(leadInToDrop(60, 1000)).toBe(30)
  })
})
