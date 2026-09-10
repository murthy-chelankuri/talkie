import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getVideoMetadata } from '@remotion/renderer'
import { createProject } from '../project/projectApi'
import { startRecordingSession } from './recordSession'
import { normalizeRecording } from './normalizeRecording'

describe('normalizeRecording (real Playwright recording)', () => {
  it('converts the capture to a seekable h264 mp4 and keeps the original', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-normalize-test-'))
    const project = createProject('Normalize', baseDir)
    const fixtureUrl = `file://${join(__dirname, 'fixtures', 'recording-test-page.html')}`

    const session = await startRecordingSession(project.id, fixtureUrl, baseDir)
    await session.page.waitForTimeout(1500)
    const recording = await session.stop()

    const normalized = await normalizeRecording(recording.videoPath)

    expect(normalized.endsWith('.mp4')).toBe(true)
    expect(statSync(normalized).size).toBeGreaterThan(0)
    // The raw capture stays on disk as the source of truth.
    expect(existsSync(recording.videoPath)).toBe(true)

    const { codec, durationInSeconds } = await getVideoMetadata(normalized)
    expect(codec).toBe('h264')
    expect(durationInSeconds).toBeGreaterThan(0)

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)

  it('falls back to the original file when the conversion cannot run', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-normalize-fail-test-'))
    const notAVideo = join(baseDir, 'video.webm')
    rmSync(notAVideo, { force: true })

    // ffmpeg cannot read a file that is not there, so this exercises the fallback.
    expect(await normalizeRecording(notAVideo)).toBe(notAVideo)

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)
})
