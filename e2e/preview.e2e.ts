import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, openProject, type Talkie } from './app'
import { CUT_FRAME, makeFixtureWithCut, type Fixture } from './fixture'
import { FPS, NARRATION_LEAD_IN_FRAMES } from '../src/remotion/constants'

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
})
