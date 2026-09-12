import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, statSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../project/projectApi'
import { addTimelineItem } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { renderProjectVideo } from './renderProject'
import { closeAssetServer } from './assetServer'
import { startRecordingSession } from '../capture/recordSession'
import { importRecordedSession } from '../capture/importRecordedSession'

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('renderProjectVideo', () => {
  afterEach(async () => {
    await closeAssetServer()
  })

  it('renders the project timeline to a real MP4 file in renders/', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-render-test-'))
    const project = createProject('Render Test', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    const imagePath = join(dir, 'sources', 'images', 'pixel.png')
    writeFileSync(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'))
    addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: imagePath } }, baseDir)

    const outputPath = await renderProjectVideo(project.id, baseDir)

    expect(statSync(outputPath).size).toBeGreaterThan(0)
    expect(readdirSync(join(dir, 'renders'))).toContain(outputPath.split('/').pop())

    rmSync(baseDir, { recursive: true, force: true })
  }, 180_000)

  it('renders a recorded video timeline item to a real MP4 file', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-render-video-test-'))
    const project = createProject('Render Video Test', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string

    // Produce a genuine .webm the same way a real capture session does, so this exercises the
    // exact media the recording pipeline puts on the timeline.
    const fixtureUrl = `file://${join(__dirname, '..', 'capture', 'fixtures', 'recording-test-page.html')}`
    const session = await startRecordingSession(project.id, fixtureUrl, baseDir)
    // Long enough that the trimmed clip still clears the "keep at least a second" guard.
    await session.page.waitForTimeout(2000)
    const recording = await session.stop()
    // Import with a lead-in to trim, so this also covers rendering a trimmed clip.
    const item = await importRecordedSession(project.id, recording.videoPath, baseDir, { contentStartMs: 300 })
    expect(item.kind).toBe('video')
    expect((item.data as { trimBefore?: number }).trimBefore).toBe(9)

    const outputPath = await renderProjectVideo(project.id, baseDir)

    expect(statSync(outputPath).size).toBeGreaterThan(0)
    expect(readdirSync(join(dir, 'renders'))).toContain(outputPath.split('/').pop())

    rmSync(baseDir, { recursive: true, force: true })
  }, 180_000)
})

describe('exportFileName', () => {
  it('names the file after the demo and the day it was made', async () => {
    const { exportFileName } = await import('./renderProject')

    expect(exportFileName('Checkout demo', new Date(2026, 8, 11))).toBe('checkout-demo-2026-09-11')
  })

  it('pads months and days so the names sort', async () => {
    const { exportFileName } = await import('./renderProject')

    expect(exportFileName('Demo', new Date(2026, 0, 5))).toBe('demo-2026-01-05')
  })

  it('still produces a usable name for a project whose title is all punctuation', async () => {
    const { exportFileName } = await import('./renderProject')

    expect(exportFileName('!!!', new Date(2026, 8, 11))).toBe('untitled-2026-09-11')
  })
})
