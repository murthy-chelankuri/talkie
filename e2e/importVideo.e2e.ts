import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { exportsIn, launchTalkie, openProject, type Talkie } from './app'
import { makeFixture, type Fixture } from './fixture'
import { editedVideo } from '../src/main/capture/testVideos'
import { findProjectDir } from '../src/main/project/paths'
import { toolPath } from '../src/main/media'
import { FPS } from '../src/composition/constants'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

type Clip = { id: string; kind: string; start: number; duration: number; data: { src?: string; trimBefore?: number } }

function timelineOnDisk(): Clip[] {
  return JSON.parse(readFileSync(join(findProjectDir(fixture.projectId, fixture.home)!, 'timeline.json'), 'utf8'))
}

/**
 * A video made somewhere else, brought in through the Add panel: cut into scenes where its shots
 * change, played across those cuts from the one copy in the project, and exported whole. The
 * picker is the system's, so the test answers it the way a person would, with a file.
 */
describe('importing a video', () => {
  it('lands as one scene per shot, plays across the cut, and exports at its full length', async () => {
    fixture = makeFixture()
    const video = join(fixture.home, 'edited.mp4')
    await editedVideo(video)
    talkie = await launchTalkie(fixture)
    const { app, win } = talkie
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, video)
    await openProject(win)

    await win.getByRole('tab', { name: 'Add' }).click()
    await win.getByRole('button', { name: 'Import a video' }).click()
    await expect.poll(() => timelineOnDisk().filter((clip) => clip.kind === 'video').length, { timeout: 60_000 }).toBe(3)

    const scenes = timelineOnDisk().filter((clip) => clip.kind === 'video')
    expect(scenes.map((clip) => clip.duration)).toEqual([6 * FPS, 7 * FPS, 8 * FPS])
    expect(new Set(scenes.map((clip) => clip.data.src)).size).toBe(1)

    // Across the cut from the first shot to the second: the playhead carries on, and the picture
    // is the second scene's stretch of the file — six seconds in — not the first's again.
    const cut = scenes[1].start
    const track = win.getByRole('slider', { name: 'Playback position' })
    await track.waitFor()
    const box = (await track.boundingBox())!
    const total = Number(await track.getAttribute('aria-valuemax')) + 1
    await win.mouse.click(box.x + (box.width * (cut - 15 + 0.5)) / total, box.y + box.height / 2)
    await win.getByRole('button', { name: 'Play', exact: true }).click()
    await expect
      .poll(() => win.evaluate(() => Number(document.querySelector('[aria-label="Playhead"]')?.getAttribute('aria-valuenow'))), { timeout: 10_000 })
      .toBeGreaterThan(cut + 20)
    const seconds = await win.evaluate(
      () => Array.from(document.querySelectorAll('video')).find((el) => el.checkVisibility({ visibilityProperty: true }))?.currentTime ?? -1
    )
    await win.getByRole('button', { name: 'Pause', exact: true }).click()
    expect(seconds).toBeGreaterThan(6.4)
    expect(seconds).toBeLessThan(8)

    await win.getByRole('button', { name: 'Export video' }).click()
    await win.getByText('Video exported').waitFor({ timeout: 150_000 })
    const [exported] = exportsIn(fixture)
    const length = Number(
      execFileSync(toolPath('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', exported], { encoding: 'utf8' })
    )
    // Three slides of five seconds, then the video's twenty-one.
    expect(length).toBeGreaterThan(35)
    expect(length).toBeLessThan(38)
  }, 300_000)
})
