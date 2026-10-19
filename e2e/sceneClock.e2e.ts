import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, type Talkie } from './app'
import { makeFixture, type Fixture } from './fixture'
import { FPS } from '../src/composition/constants'
import { projectsRootDir } from '../src/main/project/paths'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

/**
 * The scene clock is what narration is timed against, so it has to agree with the video's clock and
 * the timeline: skipping to a scene puts it at that scene's 0.0, and the video at the scene's start.
 */
describe('the scene clock', () => {
  it('starts again at each scene, where the video clock reads the scene’s start', async () => {
    fixture = makeFixture()
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await win.getByRole('button', { name: 'Open Taskboard walkthrough' }).click()
    await win.getByRole('tablist', { name: 'Ways to work on this project' }).waitFor()

    const root = projectsRootDir(fixture.home)
    const dir = readdirSync(root)
      .map((entry) => join(root, entry))
      .find((each) => JSON.parse(readFileSync(join(each, 'project.json'), 'utf8')).name === 'Taskboard walkthrough')!
    const clips = (JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8')) as { start: number; duration: number }[]).sort(
      (a, b) => a.start - b.start
    )

    await win.getByRole('button', { name: 'Next clip' }).click()
    await win.getByRole('button', { name: 'Next clip' }).click()

    const scene = win.getByRole('group', { name: 'Time in this scene' })
    await expect.poll(() => scene.textContent()).toBe(`Scene 3 0.0s of ${(Math.floor((clips[2].duration / FPS) * 10) / 10).toFixed(1)}s`)
    const start = clips[2].start / FPS
    const video = `${Math.floor(start / 60)}:${String(Math.floor(start) % 60).padStart(2, '0')}.${Math.floor(start * 10) % 10}`
    expect(await win.getByLabel('Time in the video').textContent()).toContain(video)

    if (process.env.TALKIE_SHOT) await win.screenshot({ path: process.env.TALKIE_SHOT })
  }, 90_000)
})
