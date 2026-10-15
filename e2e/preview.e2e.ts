import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type { Page } from 'playwright'
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

  it('plays across every kind of cut in every example: on, never back, and voiced after it', async () => {
    // Each bug here was seen only by playing a real project across a cut: a take that ended before
    // its clip was played again, sending the preview round its first scene for ever; an HTML
    // scene mounted early was thrown away at the cut and logged a frame it never drew. The fixture
    // has none of those shapes and the examples have all of them, so the examples are what plays —
    // across the first cut, and across each kind of cut (slide to video, video to diagram, …)
    // once per example, which is about half of them and every pairing they contain.
    fixture = makeFixture()
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    const problems: string[] = []

    for (const name of EXAMPLES) {
      await win.getByRole('button', { name: `Open ${name}` }).click()
      await win.getByRole('tablist', { name: 'Ways to work on this project' }).waitFor()
      const { clips, voiced } = exampleOnDisk(fixture.home, name)

      for (const i of cutsToCross(clips)) {
        const cut = clips[i].start
        const label = `${name}, ${clips[i - 1].kind} → ${clips[i].kind} at frame ${cut}`
        await seek(win, cut - 20)
        await win.getByRole('button', { name: 'Play', exact: true }).click()
        const frames: number[] = []
        let heard = false
        const until = cut + NARRATION_LEAD_IN_FRAMES + 24
        const deadline = Date.now() + 8_000
        while (Date.now() < deadline) {
          const now = await win.evaluate(() => ({
            frame: Number(document.querySelector('[aria-label="Playhead"]')?.getAttribute('aria-valuenow')),
            sounding: Array.from(document.querySelectorAll('audio')).some((el) => !el.paused && el.currentTime > 0)
          }))
          frames.push(now.frame)
          if (now.frame > cut + NARRATION_LEAD_IN_FRAMES + 8 && now.sounding) heard = true
          if (now.frame >= until) break
          await win.waitForTimeout(80)
        }
        await win.getByRole('button', { name: 'Pause', exact: true }).click()

        const back = frames.flatMap((frame, at) => (at > 0 && frame < frames[at - 1] ? [`${frames[at - 1]}→${frame}`] : []))
        if (back.length) problems.push(`${label}: went back ${back.join(' ')}`)
        if (frames.at(-1)! < until) problems.push(`${label}: stopped at ${frames.at(-1)}, short of ${until}`)
        if (voiced.has(clips[i].id) && !heard) problems.push(`${label}: no narration playing after the cut`)
      }
      // Back by the project switcher, as a person goes from one project to the next.
      await win.getByRole('button', { name, exact: true }).click()
      await win.getByRole('menuitem', { name: 'All projects' }).click()
    }

    expect(problems).toEqual([])
  }, 240_000)
})

const EXAMPLES = ['Tidewell product launch', 'Taskboard walkthrough', 'Where does a photo go?', 'Meet Talkie']

type Clip = { id: string; kind: string; start: number; duration: number }

/** An installed example's clips, and which of them have a take. */
function exampleOnDisk(home: string, name: string): { clips: Clip[]; voiced: Set<string> } {
  const root = join(home, 'Talkie', 'Projects')
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry)
    if (JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).name !== name) continue
    const timeline = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8'))
    const segments: { timelineItemId: string; audioFile?: string }[] = JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8'))
    return {
      clips: Array.isArray(timeline) ? timeline : timeline.items,
      voiced: new Set(segments.filter((segment) => segment.audioFile).map((segment) => segment.timelineItemId))
    }
  }
  throw new Error(`${name} is not installed`)
}

/** The first cut, and the first of each kind of cut after it: which clip kind to which. */
function cutsToCross(clips: Clip[]): number[] {
  const seen = new Set<string>()
  return clips.flatMap((clip, i) => {
    if (i === 0) return []
    const kind = `${clips[i - 1].kind}→${clip.kind}`
    if (i > 1 && seen.has(kind)) return []
    seen.add(kind)
    return [i]
  })
}

/** Puts the playhead at `frame` the way a person does, by clicking the transport's track. */
async function seek(win: Page, frame: number): Promise<void> {
  const track = win.getByRole('slider', { name: 'Playback position' })
  const box = (await track.boundingBox())!
  const total = Number(await track.getAttribute('aria-valuemax')) + 1
  await win.mouse.click(box.x + (box.width * (frame + 0.5)) / total, box.y + box.height / 2)
}
