import { execFileSync } from 'child_process'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { exportsIn, launchTalkie, openProject, type Talkie } from './app'
import { takeShape, type TakeShape } from './audio'
import { makeFixture, type Fixture } from './fixture'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

/** The ffmpeg and ffprobe the export itself uses, so the run needs nothing else installed. */
const BINARIES = dirname(require.resolve('@remotion/compositor-darwin-arm64/package.json'))

function probe(path: string): { seconds: number; audio: boolean } {
  const out = execFileSync(join(BINARIES, 'ffprobe'), [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', path
  ], { env: { ...process.env, DYLD_LIBRARY_PATH: BINARIES } }).toString()
  const parsed = JSON.parse(out) as { format: { duration: string }; streams: { codec_type: string }[] }
  return {
    seconds: Number(parsed.format.duration),
    audio: parsed.streams.some((stream) => stream.codec_type === 'audio')
  }
}

/**
 * The video's soundtrack, taken out as a WAV so it can be measured like a take. Through a file
 * because the ffmpeg Remotion ships has neither `volumedetect` nor a raw PCM muxer.
 */
function soundtrack(video: string): TakeShape {
  const wav = join(fixture.home, 'soundtrack.wav')
  execFileSync(join(BINARIES, 'ffmpeg'), ['-v', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-c:a', 'pcm_s16le', wav], {
    env: { ...process.env, DYLD_LIBRARY_PATH: BINARIES }
  })
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
    await win.getByText('Video exported').waitFor({ timeout: 150_000 })

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
})
