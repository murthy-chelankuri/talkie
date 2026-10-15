import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, type Talkie } from '../app'
import { makeFixture, type Fixture } from '../fixture'
import { exportedVideo, projectOnDisk, videoSeconds, voicedClipsInExport } from './exported'
import { FPS } from '../../src/composition/constants'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

const EXAMPLES = ['Tidewell product launch', 'Taskboard walkthrough', 'Where does a photo go?', 'Meet Talkie']

/**
 * Every shipped example, exported whole. Between them they hold every kind of clip — recordings,
 * slides, diagrams, HTML scenes — with timed and untimed narration, so this is the nearest thing to
 * everything a person can make, rendered the way they would render it. The quick run exports one
 * small fixture; this is the one that finds what only a real project does.
 */
describe('exporting the examples', () => {
  for (const name of EXAMPLES) {
    it(`exports ${name} at its full length, with its narration heard over every clip that has some`, async () => {
      fixture = makeFixture()
      talkie = await launchTalkie(fixture)
      const { win } = talkie
      await win.getByRole('button', { name: `Open ${name}` }).click()
      await win.getByRole('tablist', { name: 'Ways to work on this project' }).waitFor()

      await win.getByRole('button', { name: 'Export video' }).click()
      await win.getByText('Video exported').waitFor({ timeout: 20 * 60_000 })

      const { dir, clips, takes } = projectOnDisk(fixture.home, name)
      const video = exportedVideo(dir)
      const frames = clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0)
      expect(Math.abs(videoSeconds(video) - frames / FPS), 'length against the timeline').toBeLessThan(0.5)
      for (const { clip, heard, take } of voicedClipsInExport(video, clips, takes)) {
        // As the take sounds: heard, and no gap the take does not have. A timed take waits for the
        // picture on purpose, so its own pauses are allowed; nothing longer is.
        expect(heard.rms, `${clip.kind} at frame ${clip.start} is silent`).toBeGreaterThan(0.01)
        expect(heard.longestSilence, `${clip.kind} at frame ${clip.start} has a gap its take does not`).toBeLessThan(take.longestSilence + 0.5)
      }
    }, 25 * 60_000)
  }
})
