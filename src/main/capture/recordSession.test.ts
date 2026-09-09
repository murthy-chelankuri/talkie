import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../project/projectApi'
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
