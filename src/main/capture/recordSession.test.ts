import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../project/projectApi'
import { getVideoMetadata } from '@remotion/renderer'
import { WIDTH, HEIGHT } from '../../remotion/constants'
import { startRecordingSession } from './recordSession'
import { readActionLog } from './actionLog'

describe('startRecordingSession (real Playwright)', () => {
  it('records real clicks and navigation, and redacts password input values', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-capture-test-'))
    const project = createProject('Capture Test', baseDir)
    const fixtureUrl = `file://${join(__dirname, 'fixtures', 'recording-test-page.html')}`

    const session = await startRecordingSession(project.id, fixtureUrl, baseDir)

    await session.page.click('#test-button')
    await session.page.fill('#test-password', 'super-secret')
    await session.page.click('#test-link')
    session.markAnnotation('important')

    // The injected listener calls window.__demoEditorRecordAction(...) without awaiting it
    // (a fire-and-forget call from the page's perspective), so a page.click()/fill() promise
    // resolving does not guarantee the corresponding Node-side exposeFunction callback — and
    // therefore the action-log write — has completed yet. Give any in-flight calls a moment
    // to land before reading the log back.
    await session.page.waitForTimeout(300)

    const result = await session.stop()

    expect(existsSync(result.videoPath)).toBe(true)
    expect(statSync(result.videoPath).size).toBeGreaterThan(0)

    const entries = readActionLog(result.actionLogPath)

    const click = entries.find((e) => e.type === 'click' && e.selector === '#test-button')
    expect(click).toBeDefined()

    const passwordEntry = entries.find((e) => e.type === 'input' && e.selector === '#test-password')
    expect(passwordEntry?.value).toBe('[redacted]')

    const navigation = entries.find((e) => e.type === 'navigation' && e.url?.includes('#navigated'))
    expect(navigation).toBeDefined()

    const annotation = entries.find((e) => e.type === 'annotation')
    expect(annotation?.annotation).toBe('important')

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)
})

describe('what a recording is worth looking at', () => {
  it('captures at the size the export renders, so nothing is upscaled', async () => {
    // Recording at 1280x720 into a 1920x1080 export enlarged every clip by half again, which is
    // why text in a capture looked soft beside a slide written in the app.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-capture-size-'))
    const project = createProject('Capture Size', baseDir)
    writeFileSync(join(baseDir, 'page.html'), '<!doctype html><h1>Sized</h1>')

    const session = await startRecordingSession(project.id, `file://${join(baseDir, 'page.html')}`, baseDir)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const { videoPath } = await session.stop()

    const { width, height } = await getVideoMetadata(videoPath)
    expect({ width, height }).toEqual({ width: WIDTH, height: HEIGHT })

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)
})

describe('where a click landed', () => {
  it('records the place, not only the thing', async () => {
    // A screen recording cannot say where to look. These are what let the export say it.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-click-where-'))
    const project = createProject('Where', baseDir)
    writeFileSync(
      join(baseDir, 'page.html'),
      `<!doctype html><body style="margin:0">
       <button id="go" style="position:absolute;left:25%;top:50%;width:10%;height:10%">Go</button>
       </body>`
    )

    const session = await startRecordingSession(project.id, `file://${join(baseDir, 'page.html')}`, baseDir)
    await session.page.click('#go')
    await new Promise((resolve) => setTimeout(resolve, 400))
    const { actionLogPath } = await session.stop()

    const click = readActionLog(actionLogPath).find((entry) => entry.type === 'click')
    expect(click).toBeTruthy()
    // Shares of the viewport, so they mean the same thing at any render size.
    expect(click?.x).toBeCloseTo(0.3, 1)
    expect(click?.y).toBeCloseTo(0.55, 1)
    expect(click?.w).toBeCloseTo(0.1, 1)

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)
})
