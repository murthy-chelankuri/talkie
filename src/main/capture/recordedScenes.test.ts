import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getVideoMetadata } from '@remotion/renderer'
import { createProject } from '../project/projectApi'
import { startRecordingSession } from './recordSession'
import { importRecordedSession } from './importRecordedSession'
import { FPS } from '../../remotion/constants'

/** A page that keeps changing, so the recording cannot be mistaken for a frozen one. */
const TICKER = `<script>
  let n = 0
  setInterval(() => { document.title = String(++n) }, 100)
</script>`

describe('a recording long enough to be several scenes', () => {
  it('arrives as clips that tile the footage, each with its own stretch to narrate', async () => {
    // A session used to land as one clip however long it ran, and one clip takes one take of
    // narration — which could only be in step with the picture at the moment it started.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-scenes-'))
    const project = createProject('Scenes', baseDir)
    writeFileSync(
      join(baseDir, 'page.html'),
      `<!doctype html><body style="margin:0;font:48px sans-serif">
       <button id="a">one</button><button id="b">two</button>${TICKER}</body>`
    )

    const session = await startRecordingSession(project.id, `file://${join(baseDir, 'page.html')}`, baseDir)
    await session.page.click('#a')
    await session.page.waitForTimeout(1000)
    await session.page.click('#b')
    // The screen waiting on something, which is where a scene can end.
    await session.page.waitForTimeout(12_000)
    await session.page.click('#a')
    await session.page.waitForTimeout(14_000)
    const recording = await session.stop()

    const scenes = await importRecordedSession(project.id, recording, baseDir)
    const src = (scenes[0].data as { src: string }).src
    const { durationInSeconds } = await getVideoMetadata(src)
    const totalFrames = Math.round((durationInSeconds ?? 0) * FPS)

    expect(scenes.length).toBeGreaterThan(1)

    // Every scene plays its own stretch of the one file, and the stretches run end to end: a
    // gap would lose footage and an overlap would play it twice. They start after the blank
    // page the recording opens with, which is dropped before the split.
    let cursor = (scenes[0].data as { trimBefore?: number }).trimBefore ?? 0
    for (const scene of scenes) {
      const { trimBefore, trimAfter } = scene.data as { trimBefore?: number; trimAfter?: number }
      expect(trimBefore ?? 0).toBe(cursor)
      expect(scene.duration).toBe((trimAfter ?? totalFrames) - cursor)
      cursor = trimAfter ?? totalFrames
    }
    expect(Math.abs(cursor - totalFrames)).toBeLessThanOrEqual(1)

    // And they are laid out in order, back to back, so the demo still plays as one thing.
    expect(scenes.map((scene) => scene.start)).toEqual(
      scenes.map((_, index) => scenes.slice(0, index).reduce((total, s) => total + s.duration, 0))
    )

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)
})
