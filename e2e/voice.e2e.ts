import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, openProject, takePath, transcriptOnDisk, type Talkie } from './app'
import { takeShape } from './audio'
import { readFileSync } from 'fs'
import { join } from 'path'
import { KOKORO_SILENT_LINE, KOKORO_VOICE, kokoroAvailable, makeFixture, SCRIPT, type Fixture } from './fixture'
import { setProjectVoice } from '../src/main/project/projectApi'
import { findProjectDir } from '../src/main/project/paths'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

/**
 * Said from the start and without a gap anyone would hear as missing words. Scene 2's timings
 * ask for a two-second wait at most, so three seconds of nothing is something lost.
 */
function expectSpokenThroughout(path: string): void {
  const shape = takeShape(path)
  expect(shape.seconds, path).toBeGreaterThan(1)
  expect(shape.leadingSilence, `${path} starts with silence`).toBeLessThan(1)
  expect(shape.longestSilence, `${path} has a silence in it`).toBeLessThan(3)
}

describe('speaking the narration', () => {
  it('speaks every clip that has words in the macOS voice, from the first word', async () => {
    fixture = makeFixture('system')
    talkie = await launchTalkie(fixture)
    await openProject(talkie.win)

    await talkie.win.getByRole('button', { name: 'Speak 2 clips' }).click()
    await talkie.win.getByRole('button', { name: '1 clip needs words' }).waitFor({ timeout: 90_000 })

    const segments = transcriptOnDisk(fixture)
    expect(segments.map((segment) => segment.text)).toEqual(SCRIPT)
    for (const segment of segments) {
      expect(segment.status).toBe('narrated')
      expectSpokenThroughout(takePath(fixture, segment))
    }
  })

  it.skipIf(!kokoroAvailable())(
    'voices a scene in Kokoro without losing its first sentence',
    async () => {
      fixture = makeFixture('kokoro')
      talkie = await launchTalkie(fixture)
      await openProject(talkie.win)
      await talkie.win.getByRole('tab', { name: 'Script' }).click()

      await talkie.win.getByRole('button', { name: 'Voice Narration for scene 1' }).click()
      await expect
        .poll(() => transcriptOnDisk(fixture).find((segment) => segment.text === KOKORO_SILENT_LINE)?.audioFile, {
          timeout: 150_000,
          interval: 1000
        })
        .toBeTruthy()

      const segment = transcriptOnDisk(fixture).find((each) => each.text === KOKORO_SILENT_LINE)!
      expect(segment.voice).toBe(KOKORO_VOICE)
      expectSpokenThroughout(takePath(fixture, segment))
    },
    180_000
  )

  // The project was in Kokoro and the person moved the app to the Mac's voices: the project went on
  // naming af_heart, was handed to `say` in a voice it does not have, and its picker listed only
  // Kokoro's voices, so there was nothing to move it to.
  it.skipIf(!kokoroAvailable())(
    'moves a project in Kokoro to a Mac voice after the app has moved, and speaks it in that voice',
    async () => {
      fixture = makeFixture('kokoro')
      setProjectVoice(fixture.projectId, KOKORO_VOICE, fixture.home)
      talkie = await launchTalkie(fixture)
      const { win } = talkie
      await openProject(win)

      await win.getByRole('button', { name: 'Settings' }).click()
      const settings = win.getByRole('dialog', { name: 'Settings' })
      const macVoices = settings.getByRole('radio', { name: /macOS voices/ })
      // Checked once the setting is saved, not on the click itself.
      await macVoices.click()
      await expect.poll(() => macVoices.isChecked()).toBe(true)
      await settings.getByRole('button', { name: 'Done' }).click()

      await win.getByRole('tab', { name: 'Voice' }).click()
      const picker = win.getByRole('combobox', { name: 'Voice for this project' })
      // The app followed its engine to a Mac voice, and the project still has both engines to choose from.
      await expect.poll(() => picker.locator('option').first().textContent()).toBe('App default (Samantha)')
      await expect.poll(() => picker.inputValue()).toBe(KOKORO_VOICE)
      // Newer macOS names it "Samantha (English (US))"; older, "Samantha".
      const samantha = (await picker.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).find(
        (value) => value === 'Samantha' || value.startsWith('Samantha (')
      )!
      await picker.selectOption(samantha)

      const projectFile = join(findProjectDir(fixture.projectId, fixture.home)!, 'project.json')
      await expect.poll(() => JSON.parse(readFileSync(projectFile, 'utf8')).voice).toBe(samantha)

      await win.getByRole('button', { name: 'Speak 2 clips' }).click()
      await win.getByRole('button', { name: '1 clip needs words' }).waitFor({ timeout: 90_000 })
      for (const segment of transcriptOnDisk(fixture)) {
        expect(segment.voice).toBe(samantha)
        expectSpokenThroughout(takePath(fixture, segment))
      }
    },
    180_000
  )
})
