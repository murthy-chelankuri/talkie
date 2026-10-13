import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, type Talkie } from './app'
import { makeFixture, type Fixture } from './fixture'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

describe('the examples', () => {
  it('are among the projects on first launch, and play', async () => {
    fixture = makeFixture()
    talkie = await launchTalkie(fixture)
    const { win } = talkie

    for (const name of ['Meet Talkie', 'Lumen product launch', 'Taskboard walkthrough', 'Where does a photo go?']) {
      await win.getByRole('button', { name: `Open ${name}` }).waitFor()
    }
    await win.getByRole('button', { name: 'Open Meet Talkie' }).click()
    await win.getByRole('tablist', { name: 'Ways to work on this project' }).waitFor()
    await win.getByRole('button', { name: 'Play', exact: true }).click()
    await expect
      .poll(async () => /(\d+:\d\d)\s*\/\s*\d+:\d\d/.exec(await win.locator('body').innerText())?.[1], { timeout: 10_000 })
      .not.toBe('0:00')
  })
})
