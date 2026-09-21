import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getVideoMetadata } from '@remotion/renderer'
import { createProject } from '../project/projectApi'
import { startRecordingSession } from './recordSession'
import { importRecordedSession } from './importRecordedSession'
import { FPS } from '../../remotion/constants'

/** A page that keeps changing, so its recording cannot be mistaken for a frozen one. */
const TICKER = `<script>
  let n = 0
  setInterval(() => { document.body.firstElementChild.textContent = String(++n) }, 100)
</script>`

function writePages(baseDir: string): { first: string } {
  writeFileSync(
    join(baseDir, 'second.html'),
    `<!doctype html><body style="margin:0;font:48px sans-serif;background:#0b0"><div>second</div>${TICKER}</body>`
  )
  writeFileSync(
    join(baseDir, 'page.html'),
    `<!doctype html><body style="margin:0;font:48px sans-serif"><div>first</div>
     <a id="go" target="_blank" href="second.html">open</a>${TICKER}</body>`
  )
  return { first: `file://${join(baseDir, 'page.html')}` }
}

describe('a recording of a session that moves between tabs', () => {
  it('keeps what happened in the new tab, not just the tab it started on', async () => {
    // A link that opens a tab is an ordinary thing to do in a demo. Playwright starts a second
    // video for it, and Talkie used to keep only the first — so the demo was cut off at the
    // click and the rest sat on disk in a file nothing looked at.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-session-tabs-'))
    const project = createProject('Tabs', baseDir)
    const { first } = writePages(baseDir)

    const session = await startRecordingSession(project.id, first, baseDir)
    await session.page.waitForTimeout(2000)

    const context = session.page.context()
    const [second] = await Promise.all([context.waitForEvent('page'), session.page.click('#go')])
    await second.waitForLoadState()
    await second.bringToFront()
    await second.waitForTimeout(4000)

    const recording = await session.stop()

    // One stretch on each tab, in the order they were watched.
    expect(recording.clips).toHaveLength(2)
    expect(recording.clips[0].videoPath).not.toBe(recording.clips[1].videoPath)
    // The second tab's clip starts at the top of its own recording; the first tab's does not
    // run past the moment attention left it.
    expect(recording.clips[1].trimBeforeMs).toBeLessThan(500)
    expect(recording.clips[0].durationMs).toBeGreaterThan(1500)
    expect(recording.clips[1].durationMs).toBeGreaterThan(3000)

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)

  it('does not end when the tab it started on is closed', async () => {
    // Closing that tab finalises its video. Everything after it used to be lost.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-session-close-'))
    const project = createProject('Closed', baseDir)
    const { first } = writePages(baseDir)

    const session = await startRecordingSession(project.id, first, baseDir)
    await session.page.waitForTimeout(2000)

    const context = session.page.context()
    const second = await context.newPage()
    await second.goto(`file://${join(baseDir, 'second.html')}`)
    await second.bringToFront()
    await session.page.close()
    await second.waitForTimeout(4000)

    const recording = await session.stop()
    const scenes = await importRecordedSession(project.id, recording, baseDir)
    const item = scenes[0]

    // The whole session, not the two seconds before the tab went away — however many scenes it
    // was cut into on the way in.
    expect(scenes.reduce((total, scene) => total + scene.duration, 0)).toBeGreaterThan(5 * FPS)

    const { durationInSeconds } = await getVideoMetadata((item.data as { src: string }).src)
    expect(durationInSeconds).toBeGreaterThan(5)

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)

  it('lays the stretches end to end in one playable file', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-session-stitch-'))
    const project = createProject('Stitched', baseDir)
    const { first } = writePages(baseDir)

    const session = await startRecordingSession(project.id, first, baseDir)
    await session.page.waitForTimeout(2000)
    const context = session.page.context()
    const [second] = await Promise.all([context.waitForEvent('page'), session.page.click('#go')])
    await second.waitForLoadState()
    await second.bringToFront()
    await second.waitForTimeout(3000)
    const recording = await session.stop()

    const [item] = await importRecordedSession(project.id, recording, baseDir)
    const watched = recording.clips.reduce((total, clip) => total + clip.durationMs, 0)

    const { durationInSeconds, codec } = await getVideoMetadata((item.data as { src: string }).src)
    // Seekable H.264, and as long as the two stretches together — within a second, since the
    // browser's own recorder rounds to whole frames at each end.
    expect(codec).toBe('h264')
    expect(durationInSeconds).toBeGreaterThan(watched / 1000 - 1)
    expect(durationInSeconds).toBeLessThan(watched / 1000 + 1)

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)
})

describe('a recording of a sign-in that happens in its own window', () => {
  it('keeps the app the person went back to after the provider window closed', async () => {
    // Signing in through a provider is a window that opens, is used, and closes itself. The tab
    // underneath was never hidden, so nothing reports it shown again: a window closing does not
    // fire visibilitychange on the one it covered, and an app that redraws in place — which is
    // what a single-page app does with the token it was handed — never navigates, so the init
    // script does not run again either. The session used to end at that close, and the demo the
    // person then gave was recorded to a file no clip ever pointed at.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-session-sso-'))
    const project = createProject('Provider', baseDir)

    writeFileSync(
      join(baseDir, 'sso.html'),
      `<!doctype html><body style="margin:0;font:48px sans-serif;background:#00b"><div>provider</div>
       <input id="p" type="password" autocomplete="current-password">${TICKER}</body>`
    )
    writeFileSync(
      join(baseDir, 'start.html'),
      `<!doctype html><body style="margin:0;font:48px sans-serif"><div>start</div>
       <button id="sso" onclick="window.open('sso.html', '_blank', 'width=600,height=700')">Sign in</button>${TICKER}</body>`
    )

    const session = await startRecordingSession(project.id, `file://${join(baseDir, 'start.html')}`, baseDir)
    await session.page.waitForTimeout(1500)

    const context = session.page.context()
    const [provider] = await Promise.all([context.waitForEvent('page'), session.page.click('#sso')])
    await provider.waitForLoadState()
    await provider.bringToFront()
    await provider.fill('#p', 'hunter2')
    await provider.waitForTimeout(1500)

    // Nothing brings the original tab forward: the person was already looking at it.
    await provider.close()
    await session.page.evaluate(() => {
      document.body.firstElementChild!.textContent = 'signed in'
    })
    await session.page.waitForTimeout(5000)

    const recording = await session.stop()

    const afterSignIn = recording.clips
      .filter((clip) => clip.fromSessionMs > 3000)
      .reduce((total, clip) => total + clip.durationMs, 0)

    expect(afterSignIn).toBeGreaterThan(4000)

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)
})
