import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, openProject, type Talkie } from './app'
import { makeFixture, type Fixture } from './fixture'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

const DECK = join(__dirname, '..', 'src', 'main', 'slides', 'fixtures', 'two-pages.pdf')

type Slide = { kind: string; data: { title: string; bullets: string[]; picture?: string; showPicture?: boolean } }

function timelineOnDisk(fixture: Fixture): Slide[] {
  const root = join(fixture.home, 'Talkie', 'Projects')
  const dir = join(root, readdirSync(root).find((entry) => entry.startsWith(fixture.projectId))!)
  return JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8'))
}

/**
 * A deck brought in to be talked over, and changed to fit what is said: its pages arrive as
 * slides whose words can be edited in Talkie, each keeping the page it came from to show instead
 * where the deck's own design matters. The words are read in the window as the pages are drawn,
 * and the page has to reach the preview through the asset server — two places a slide that only
 * ever held words had never needed to go.
 */
describe('a slide deck', () => {
  it('arrives as editable slides, and each can be shown as its original page instead', async () => {
    fixture = makeFixture()
    talkie = await launchTalkie(fixture)
    const { app, win } = talkie
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, DECK)
    await openProject(win)

    await win.getByRole('tab', { name: 'Add' }).click()
    await win.getByRole('button', { name: /Import slides/ }).click()
    await expect.poll(() => timelineOnDisk(fixture).length, { timeout: 30_000 }).toBe(5)

    const imported = timelineOnDisk(fixture).slice(3)
    expect(imported.map((slide) => slide.kind)).toEqual(['scene', 'scene'])
    expect(imported.map((slide) => slide.data.title)).toEqual(['Talkie Overview', 'How it works'])
    expect(imported[1].data.bullets).toEqual(['Capture a session', 'Draft the narration', 'Export an MP4'])

    // Shown as the page: chosen in the slide's editor, and then what the timeline and preview draw.
    await win.getByTitle('Double-click to edit this scene').nth(4).dblclick()
    const editor = win.getByRole('dialog', { name: 'Edit scene' })
    await editor.getByRole('button', { name: 'Original page' }).click()
    await editor.getByRole('img', { name: 'The original page' }).waitFor()
    await editor.getByRole('button', { name: 'Save scene' }).click()
    await editor.waitFor({ state: 'detached' })

    const shown = timelineOnDisk(fixture)[4].data
    expect(shown.showPicture).toBe(true)
    expect(shown.picture).toBe(imported[1].data.picture)
    expect(shown.title, 'the words are kept for switching back').toBe('How it works')
    await win.getByTitle('Double-click to edit this scene').nth(4).click()
    await expect
      .poll(() =>
        win.evaluate(() =>
          Array.from(document.querySelectorAll('img')).some((img) => img.src.includes('-slide-2.png') && img.complete && img.naturalWidth > 0)
        )
      )
      .toBe(true)
  })
})
