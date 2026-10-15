import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, openProject, type Talkie } from './app'
import { CUT_FRAME, makeFixture, makeFixtureWithCut, type Fixture } from './fixture'
import { FPS, NARRATION_LEAD_IN_FRAMES } from '../src/composition/constants'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

type Media = { seconds: number; playing: boolean }
type Sample = { frame: number; video: Media | null; audio: Media | null }

/**
 * The clock, the picture and the sound, read in one go so they describe the same instant. The
 * clock is the playhead's own reading; the video is the one on screen (a clip mounted early for
 * the next cut is hidden), the audio whichever take is playing.
 */
function sample(): Sample {
  const frame = Number(document.querySelector('[aria-label="Playhead"]')?.getAttribute('aria-valuenow'))
  const video = Array.from(document.querySelectorAll('video')).find((el) => el.checkVisibility({ visibilityProperty: true }))
  const audio = Array.from(document.querySelectorAll('audio')).find((el) => !el.paused)
  const read = (el: HTMLMediaElement | undefined): Media | null => (el ? { seconds: el.currentTime, playing: !el.paused && el.readyState >= 2 } : null)
  return { frame, video: read(video), audio: read(audio) }
}

describe('the preview', () => {
  it('keeps the recording and the narration within two frames of the clock across a cut', async () => {
    fixture = await makeFixtureWithCut()
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await openProject(win)

    await win.getByRole('button', { name: 'Play', exact: true }).click()
    const samples: Sample[] = []
    const narrationStart = CUT_FRAME + NARRATION_LEAD_IN_FRAMES
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const now = await win.evaluate(sample)
      samples.push(now)
      if (now.frame > narrationStart + 45) break
      await win.waitForTimeout(80)
    }

    // The recording starts at frame 0 of its file; the take a lead-in after the slide's first frame.
    // Startup is left out: the first frames are the video being asked to start, not kept in step.
    const videoDrift = samples
      .filter((s) => s.video?.playing && s.frame > 6 && s.frame < CUT_FRAME - 2)
      .map((s) => Math.abs(s.video!.seconds * FPS - s.frame))
    const audioDrift = samples
      .filter((s) => s.audio?.playing && s.frame >= narrationStart)
      .map((s) => Math.abs(narrationStart + s.audio!.seconds * FPS - s.frame))

    expect(videoDrift.length, 'samples of the recording playing').toBeGreaterThanOrEqual(3)
    expect(audioDrift.length, 'samples of the narration playing after the cut').toBeGreaterThanOrEqual(3)
    expect(Math.max(...videoDrift), `video drift ${JSON.stringify(videoDrift)}`).toBeLessThanOrEqual(2)
    expect(Math.max(...audioDrift), `audio drift ${JSON.stringify(audioDrift)}`).toBeLessThanOrEqual(2)
  }, 90_000)

  it('plays on from scene to scene, never back, through slides and HTML scenes alike', async () => {
    // Each of Tidewell's takes ends before its clip does, and two of its first four clips are HTML
    // scenes. A finished take was played again when the clock reached the end of it, so the preview
    // went round its first scene for ever; and an HTML scene mounted early was thrown away at the
    // cut, leaving a draw it had asked for to fail five seconds later as an error in the window.
    fixture = makeFixture()
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await win.getByRole('button', { name: 'Open Tidewell product launch' }).click()
    await win.getByRole('tablist', { name: 'Ways to work on this project' }).waitFor()

    await win.getByRole('button', { name: 'Play', exact: true }).click()
    const frames: number[] = []
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      frames.push(await win.evaluate(() => Number(document.querySelector('[aria-label="Playhead"]')?.getAttribute('aria-valuenow'))))
      if (frames.at(-1)! > 700) break
      await win.waitForTimeout(100)
    }

    const backwards = frames.flatMap((frame, i) => (i > 0 && frame < frames[i - 1] ? [`${frames[i - 1]}→${frame}`] : []))
    expect(backwards, 'the playhead went back').toEqual([])
    expect(frames.at(-1), 'how far it played').toBeGreaterThan(700)
  }, 90_000)
})
