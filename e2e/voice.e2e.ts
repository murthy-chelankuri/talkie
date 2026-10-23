import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, openProject, takePath, transcriptOnDisk, type Talkie } from './app'
import { takeShape } from './audio'
import { KOKORO_SILENT_LINE, KOKORO_VOICE, kokoroAvailable, makeFixture, SCRIPT, type Fixture } from './fixture'

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
  it.skipIf(!kokoroAvailable())('speaks every clip that has words in Kokoro, from the first word', async () => {
    fixture = makeFixture({ kokoro: true })
    talkie = await launchTalkie(fixture)
    await openProject(talkie.win)

    await talkie.win.getByRole('button', { name: 'Speak 2 clips' }).click()
    await talkie.win.getByRole('button', { name: '1 clip needs words' }).waitFor({ timeout: 150_000 })

    const segments = transcriptOnDisk(fixture)
    expect(segments.map((segment) => segment.text)).toEqual([KOKORO_SILENT_LINE, SCRIPT[1]])
    for (const segment of segments) {
      expect(segment.status).toBe('narrated')
      expectSpokenThroughout(takePath(fixture, segment))
    }
  })

  it.skipIf(!kokoroAvailable())(
    'voices a scene in Kokoro without losing its first sentence',
    async () => {
      fixture = makeFixture({ kokoro: true })
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
})
