import { execFileSync, execSync } from 'child_process'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { exportsIn, launchTalkie, openProject, type Talkie } from './app'
import { takeShape, type TakeShape } from './audio'
import { makeFixture, type Fixture } from './fixture'
import { ffmpegPath, ffprobePath } from '../src/main/media'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

function probe(path: string): { seconds: number; audio: boolean } {
  const out = execFileSync(ffprobePath(), [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', path
  ]).toString()
  const parsed = JSON.parse(out) as { format: { duration: string }; streams: { codec_type: string }[] }
  return {
    seconds: Number(parsed.format.duration),
    audio: parsed.streams.some((stream) => stream.codec_type === 'audio')
  }
}

/**
 * The video's soundtrack, taken out as a WAV so it can be measured like a take. Through a file
 * decoded to PCM and measured here rather than by a filter, which keeps the measurement the same whatever ffmpeg build is installed.
 */
function soundtrack(video: string): TakeShape {
  const wav = join(fixture.home, 'soundtrack.wav')
  execFileSync(ffmpegPath(), ['-v', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-c:a', 'pcm_s16le', wav])
  return takeShape(wav)
}

describe('exporting', () => {
  it('exports the narrated project as a video you can hear', async () => {
    fixture = makeFixture('system')
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await openProject(win)

    await win.getByRole('button', { name: 'Speak 2 clips' }).click()
    await win.getByRole('button', { name: '1 clip needs words' }).waitFor({ timeout: 90_000 })

    await win.getByRole('button', { name: 'Export video' }).click()
    // It says how far it has got while it works, not only that it is busy.
    await win.getByRole('progressbar', { name: 'Export' }).waitFor()
    await win.getByText('Video exported').waitFor({ timeout: 150_000 })
    await win.getByText(/took \d+ (sec|min)/).waitFor()

    const [video] = exportsIn(fixture)
    expect(video, 'no MP4 was written').toBeTruthy()
    const { seconds, audio } = probe(video)
    expect(seconds).toBeGreaterThan(14)
    expect(seconds).toBeLessThan(20)
    expect(audio, 'the video has no soundtrack').toBe(true)
    // Narration over the first two scenes, and the third has none: the track is heard, and
    // starts within the lead-in rather than seconds into the video.
    const track = soundtrack(video)
    expect(track.rms, 'the soundtrack is silent').toBeGreaterThan(0.01)
    expect(track.leadingSilence, 'the narration starts late').toBeLessThan(1.5)
  }, 240_000)

  it('can be cancelled part way, and says so', async () => {
    fixture = makeFixture('system')
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await openProject(win)

    await win.getByRole('button', { name: 'Export video' }).click()
    await win.getByText(/Drawing frame/).waitFor({ timeout: 60_000 })
    await win.getByRole('button', { name: 'Cancel export' }).click()

    await win.getByText('Export cancelled').waitFor({ timeout: 30_000 })
    await win.getByRole('button', { name: 'Export video' }).waitFor()
  }, 120_000)

  it('leaves no browser running when the app quits part way through', async () => {
    // Quitting under an export left its browsers running with no parent — five were found,
    // holding 4GB, the oldest two days old.
    const browsers = (): number =>
      Number(
        execSync(
          "ps -axo command | grep -E 'chrome-headless-shell|MacOS/Google Chrome about:blank' | grep -v grep | grep -cv 'Helper|crashpad' || true"
        )
          .toString()
          .trim()
      )
    const before = browsers()
    fixture = makeFixture('system')
    talkie = await launchTalkie(fixture)
    const { win } = talkie
    await openProject(win)

    await win.getByRole('button', { name: 'Export video' }).click()
    await win.getByText(/Drawing frame/).waitFor({ timeout: 60_000 })
    expect(browsers()).toBeGreaterThan(before)
    await talkie.close()

    await expect.poll(browsers, { timeout: 10_000 }).toBeLessThanOrEqual(before)
  }, 120_000)
})
