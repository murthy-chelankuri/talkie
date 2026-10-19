import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, openProject, type Talkie } from './app'
import { makeFixture, type Fixture } from './fixture'
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
 * Adding a scene is an HTML scene, started from the gallery and changed through a form: a slide is
 * a template now, its title and points are fields, and the scene playing beside the form shows a
 * change before it is saved. The page is a frame from the asset server, and the values reach it
 * by message — both places only the built app exercises.
 */
describe('adding a scene', () => {
  it('starts a slide from the gallery, changes what it says in the form, and shows it before saving', async () => {
    fixture = makeFixture()
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await openProject(win)

    await win.getByRole('tab', { name: 'Add' }).click()
    await win.getByRole('button', { name: /Add a scene/ }).click()
    const dialog = win.getByRole('dialog', { name: 'Add a scene' })
    await dialog.getByRole('button', { name: 'Start from Slide' }).click()

    await dialog.getByRole('tab', { name: 'Content', selected: true }).waitFor({ timeout: 60_000 })
    await dialog.getByRole('textbox', { name: 'Title' }).fill('Why teams switch')
    await dialog.getByRole('button', { name: 'Add point' }).click()
    await dialog.getByRole('textbox', { name: 'Point 4' }).fill('It keeps up with every release')

    // Seen in the scene before it is saved: the page inside the preview's frame shows the new title.
    await expect
      .poll(async () => {
        for (const frame of win.frames()) {
          const text = await frame.evaluate(() => document.getElementById('title')?.textContent ?? null).catch(() => null)
          if (text === 'Why teams switch') return text
        }
        return null
      }, { timeout: 20_000 })
      .toBe('Why teams switch')

    await dialog.getByRole('button', { name: /Save scene/ }).click()
    await expect
      .poll(() => {
        const root = projectsRootDir(fixture.home)
        const dir = join(root, readdirSync(root).find((entry) => entry.startsWith(fixture.projectId))!)
        const clips = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8')) as { kind: string; data: { params?: Record<string, unknown> } }[]
        return clips.find((clip) => clip.kind === 'html')?.data.params
      }, { timeout: 60_000 })
      .toEqual({
        title: 'Why teams switch',
        points: ['Record the product as you use it', 'Talkie writes the narration', 'Export a video that keeps up', 'It keeps up with every release']
      })
  }, 180_000)
})
