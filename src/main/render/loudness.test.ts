import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg } from '../media'
import { DELIVERY_LOUDNESS, TAKE_LOUDNESS, levelExport, levelTake, measuredLoudnessFilter } from './loudness'
import { readWavFormat } from '../tts/wavDuration'

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'talkie-loudness-'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function ff(args: string[]): Promise<void> {
  await runFfmpeg([...args, '-y'])
}

/** A tone at a known level stands in for a voice: loudness is measured the same way. */
async function tone(path: string, volume: string, rate = 22050): Promise<string> {
  await ff(['-f', 'lavfi', '-i', `sine=frequency=440:duration=6:sample_rate=${rate}`, '-af', `volume=${volume}`,
    '-ac', '1', '-c:a', 'pcm_s16le', path])
  return path
}

async function integratedLoudness(path: string): Promise<number> {
  const filter = await measuredLoudnessFilter(path, TAKE_LOUDNESS)
  const match = filter?.match(/measured_I=(-?[\d.]+)/)
  if (!match) throw new Error(`no measurement for ${path}`)
  return parseFloat(match[1])
}

describe('levelling a take', () => {
  it('brings a quiet take up to the level every other take sits at', async () => {
    const path = await tone(join(dir, 'quiet.wav'), '0.02')
    expect(await integratedLoudness(path)).toBeLessThan(-30)

    await levelTake(path)

    expect(await integratedLoudness(path)).toBeCloseTo(TAKE_LOUDNESS.integrated, 0)
  }, 60_000)

  it('keeps the take at its own rate and length, which is what its timing is read from', async () => {
    const path = await tone(join(dir, 'rate.wav'), '0.05')
    const before = readWavFormat(path)

    await levelTake(path)

    const after = readWavFormat(path)
    expect(after.sampleRate).toBe(before.sampleRate)
    expect(after.channels).toBe(before.channels)
    expect(after.seconds).toBeCloseTo(before.seconds, 1)
  }, 60_000)

  it('leaves a silent take alone rather than raising it by an infinite amount', async () => {
    const path = join(dir, 'silent.wav')
    await ff(['-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', '3', '-c:a', 'pcm_s16le', path])
    const before = readFileSync(path)

    await levelTake(path)

    expect(readFileSync(path).equals(before)).toBe(true)
  }, 60_000)
})

describe('levelling an export', () => {
  /** The hardware encoder the app itself uses, so the test asks ffmpeg for nothing GPL. */
  async function video(path: string, withAudio: boolean): Promise<string> {
    const still = join(dir, 'still.png')
    writeFileSync(still, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'))
    const picture = ['-loop', '1', '-framerate', '30', '-i', still]
    const audio = withAudio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=6'] : []
    const encode = ['-t', '6', '-vf', 'scale=320:180,format=yuv420p', '-c:v', 'h264_videotoolbox']
    const audioEncode = withAudio ? ['-af', 'volume=0.02', '-c:a', 'aac'] : []
    await ff([...picture, ...audio, ...encode, ...audioEncode, path])
    return path
  }

  it('brings the soundtrack to the delivery level', async () => {
    const path = await video(join(dir, 'quiet.mp4'), true)

    expect(await levelExport(path)).toBe(true)

    expect(await integratedLoudness(path)).toBeCloseTo(DELIVERY_LOUDNESS.integrated, 0)
  }, 60_000)

  it('leaves a video with no narration exactly as it was rendered', async () => {
    const path = await video(join(dir, 'silent.mp4'), false)
    const before = readFileSync(path)

    expect(await levelExport(path)).toBe(false)

    expect(readFileSync(path).equals(before)).toBe(true)
  }, 60_000)
})
