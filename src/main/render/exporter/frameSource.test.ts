import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg } from '../../media'
import { closeReaders, decodersStarted, footageFrame } from './frameSource'

let dir: string
let clip: string

/** A JPEG as raw RGB, through the pinned ffmpeg, so two frames can be compared pixel by pixel. */
async function pixels(jpeg: Buffer, name: string): Promise<Buffer> {
  writeFileSync(join(dir, `${name}.jpg`), jpeg)
  await runFfmpeg(['-v', 'error', '-i', join(dir, `${name}.jpg`), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-y', join(dir, `${name}.rgb`)])
  return readFileSync(join(dir, `${name}.rgb`))
}

function meanDifference(a: Buffer, b: Buffer): number {
  let total = 0
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i])
  return total / a.length
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'talkie-frames-'))
  clip = join(dir, 'clip.mp4')
  // testsrc2 changes every frame, so the wrong frame is a visibly different picture.
  await runFfmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=3', '-c:v', 'mpeg4', '-q:v', '2', '-y', clip])
}, 60_000)
afterAll(() => {
  closeReaders('t')
  rmSync(dir, { recursive: true, force: true })
})

describe('a recording’s frames, for the export', () => {
  it('hands out the exact frame asked for', async () => {
    const served = await footageFrame('t-0', clip, 45)
    await runFfmpeg(['-v', 'error', '-ss', '1.5', '-i', clip, '-frames:v', '1', '-q:v', '2', '-y', join(dir, 'ref.jpg')])
    const reference = readFileSync(join(dir, 'ref.jpg'))

    expect(served.subarray(0, 2).toString('hex')).toBe('ffd8')
    expect(meanDifference(await pixels(served, 'served'), await pixels(reference, 'reference'))).toBeLessThan(3)
  }, 60_000)

  it('keeps decoding forward for the next frames rather than starting again', async () => {
    const before = decodersStarted()
    for (let frame = 46; frame < 52; frame++) await footageFrame('t-0', clip, frame)
    expect(decodersStarted()).toBe(before)
  }, 60_000)

  it('starts again from the frame asked for when it is behind the decoder', async () => {
    const before = decodersStarted()
    await footageFrame('t-0', clip, 10)
    expect(decodersStarted()).toBe(before + 1)
  }, 60_000)

  it('keeps one decoder per tab, so tabs do not drag each other back and forth', async () => {
    const before = decodersStarted()
    await footageFrame('t-1', clip, 80)
    await footageFrame('t-0', clip, 11)
    expect(decodersStarted()).toBe(before + 1)
  }, 60_000)

  it('shows the last frame for a moment past the end, as a held recording does', async () => {
    const last = await footageFrame('t-2', clip, 89)
    expect(await footageFrame('t-2', clip, 120)).toEqual(last)
  }, 60_000)
})
