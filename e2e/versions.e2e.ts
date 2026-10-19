import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { exportsIn, launchTalkie, openProject, type Talkie } from './app'
import { makeFixture, type Fixture } from './fixture'
import { videoSeconds } from './long/exported'
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

function onDisk<T>(file: string): T {
  const root = projectsRootDir(fixture.home)
  const dir = join(root, readdirSync(root).find((entry) => entry.startsWith(fixture.projectId))!)
  return JSON.parse(readFileSync(join(dir, file), 'utf8'))
}

type Clip = { id: string; start: number; duration: number }

/**
 * One project cut two ways: a scene left out of a shorter version stays on the timeline, dimmed,
 * while the player plays without it and the export writes without it — and the full version is
 * still there, whole. The timeline counts frames along every scene and the player only along the
 * kept ones, so the playhead is checked to land where it is put across the gap.
 */
describe('versions of a project', () => {
  it('leaves a scene out of a shorter version, which plays and exports without it', async () => {
    fixture = makeFixture()
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await openProject(win)
    const [, middle, last] = onDisk<Clip[]>('timeline.json')
    const whole = last.start + last.duration
    const track = win.getByRole('slider', { name: 'Playback position' })
    const length = async (): Promise<number> => Number(await track.getAttribute('aria-valuemax')) + 1

    await win.getByRole('button', { name: 'Version: Full video' }).click()
    await win.getByRole('menuitem', { name: 'New version…' }).click()
    await win.getByRole('textbox', { name: 'Version name' }).fill('Short')
    await win.getByRole('button', { name: 'Make version' }).click()
    await win.getByRole('switch', { name: 'Include How it works in this version' }).click()

    const versions = onDisk<{ active: string; versions: { id: string; name: string; leftOut: string[] }[] }>('versions.json')
    const short = versions.versions.find((version) => version.name === 'Short')!
    expect(versions.active).toBe(short.id)
    expect(short.leftOut).toEqual([middle.id])
    expect(versions.versions.find((version) => version.id === 'full')!.leftOut).toEqual([])
    await expect.poll(length).toBe(whole - middle.duration)

    // Played across where the scene was: the timeline's playhead goes straight from the end of
    // the first scene to the start of the last, and is never inside the one left out — though
    // the player itself is a whole scene earlier, in its own shorter video.
    const playhead = win.locator('[aria-label="Playhead"]')
    await win.getByRole('slider', { name: 'Playback position' }).click({ position: { x: 1, y: 5 } })
    await playhead.focus()
    for (let i = 0; i < 3; i += 1) await win.keyboard.press('ArrowRight')
    await win.getByRole('button', { name: 'Play', exact: true }).click()
    const frames: number[] = []
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      frames.push(Number(await playhead.getAttribute('aria-valuenow')))
      if (frames.at(-1)! > last.start + 20) break
      await win.waitForTimeout(80)
    }
    await win.getByRole('button', { name: 'Pause', exact: true }).click()
    expect(frames.filter((frame) => frame >= middle.start && frame < middle.start + middle.duration), 'inside the left-out scene').toEqual([])
    expect(frames.at(-1), 'played on into the last scene').toBeGreaterThan(last.start + 20)

    await win.getByRole('button', { name: 'Export video' }).click()
    await win.getByText('Video exported').waitFor({ timeout: 150_000 })
    const video = exportsIn(fixture).find((path) => /short/i.test(path))
    expect(video, `an export named for the version among ${exportsIn(fixture).join(', ')}`).toBeTruthy()
    expect(Math.abs(videoSeconds(video!) - (whole - middle.duration) / FPS)).toBeLessThan(0.5)

    // The full video is still whole.
    await win.getByRole('button', { name: 'Version: Short' }).click()
    await win.getByRole('menuitemradio', { name: /Full video/ }).click()
    await expect.poll(length).toBe(whole)
    await win.getByRole('switch', { name: 'Include How it works in this version' }).waitFor()
    expect(await win.getByRole('switch', { name: 'Include How it works in this version' }).getAttribute('aria-checked')).toBe('true')
  }, 240_000)
})
