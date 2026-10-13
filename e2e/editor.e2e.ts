import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, openProject, transcriptOnDisk, type Talkie } from './app'
import { HTML_SCENE_SUBTITLE, makeFixture, makeFixtureWithHtmlScene, type Fixture } from './fixture'

let fixture: Fixture
let talkie: Talkie

async function start(): Promise<Talkie> {
  fixture = makeFixture()
  talkie = await launchTalkie(fixture)
  return talkie
}

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

describe('the editor', () => {
  it('opens a project and plays it', async () => {
    const { win } = await start()
    await openProject(win)

    await win.getByRole('button', { name: 'Play', exact: true }).click()
    await expect
      .poll(async () => /(\d+:\d\d)\s*\/\s*0:15/.exec(await win.locator('body').innerText())?.[1], { timeout: 10_000 })
      .not.toBe('0:00')
  })

  it('plays an HTML scene, not a black frame', async () => {
    fixture = await makeFixtureWithHtmlScene()
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await openProject(win)

    // The app's own policy was once stamped over the one the asset server writes for scene
    // pages, refusing their inline script: every HTML scene in a built app played black, and
    // only in a built app. Paused, a scene shows its poster; the page itself plays.
    await win.getByRole('button', { name: 'html', exact: true }).click()
    await win.getByRole('button', { name: 'Play', exact: true }).click()
    await expect
      .poll(() => win.frameLocator('iframe').locator('#subtitle').textContent().catch(() => null), { timeout: 15_000 })
      .toBe(HTML_SCENE_SUBTITLE)
  })

  it('saves what is typed in the script, and offers to speak it', async () => {
    const { win } = await start()
    await openProject(win)
    // Two clips have words and the third has none, so there are two to speak — not three, which
    // is what the button once said while doing nothing when pressed.
    await win.getByRole('button', { name: 'Speak 2 clips' }).waitFor()

    await win.getByRole('tab', { name: 'Script' }).click()
    const scene = win.getByRole('region', { name: 'Scene 3' })
    await scene.getByRole('textbox', { name: 'Narration for scene 3' }).fill('And that is the end of it.')
    await scene.getByText('Saved').waitFor()
    await expect
      .poll(() => transcriptOnDisk(fixture).map((segment) => segment.text))
      .toContain('And that is the end of it.')

    await win.getByRole('tab', { name: 'Timeline' }).click()
    await win.getByRole('button', { name: 'Speak 3 clips' }).waitFor()
  })

  it('gives the script the whole window, and Esc gives the video back', async () => {
    const { win } = await start()
    await openProject(win)
    await win.getByRole('tab', { name: 'Script' }).click()

    await win.getByRole('button', { name: 'Focus on the script' }).click()
    await win.getByRole('button', { name: 'Show the video' }).waitFor()
    await expect.poll(() => win.getByTestId('stage').isVisible()).toBe(false)

    await win.keyboard.press('Escape')
    await win.getByRole('button', { name: 'Focus on the script' }).waitFor()
    await expect.poll(() => win.getByTestId('stage').isVisible()).toBe(true)
  })

  it('copies the agent token to the clipboard', async () => {
    const { app, win } = await start()
    await app.evaluate(({ clipboard }) => clipboard.writeText('nothing copied yet'))

    await win.getByRole('button', { name: 'Settings' }).click()
    const settings = win.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: /^System/ }).click()
    await settings.getByRole('switch', { name: 'Let AI agents connect' }).click()
    await settings.getByRole('button', { name: 'Create a token' }).click()
    await settings.getByRole('button', { name: 'Copy the token' }).click()

    // The permission that writeText needs was refused for a while, and the button said nothing.
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .not.toBe('nothing copied yet')
    const token = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(await settings.innerText()).toContain(token)
  })
})
