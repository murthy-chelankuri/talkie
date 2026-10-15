import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg } from '../../media'
import { closeReaders, decodersStarted, footageFrame, liveDecoders } from './frameSource'

let dir: string
let clip: string

/** An encoded frame as raw RGB, through the pinned ffmpeg, so two frames can be compared pixel by pixel. */
async function pixels(image: Buffer, name: string): Promise<Buffer> {
  writeFileSync(join(dir, `${name}.png`), image)
  await runFfmpeg(['-v', 'error', '-i', join(dir, `${name}.png`), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-y', join(dir, `${name}.rgb`)])
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

    expect(served.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
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

describe('decoders that must not outlive their use', () => {
  let long: string
  let short: string
  beforeAll(async () => {
    // The earlier tests' decoders are still running; these count what is live from nothing.
    closeReaders('t')
    await vi.waitFor(() => expect(liveDecoders()).toBe(0), { timeout: 5000 })
    long = join(dir, 'long.mp4')
    await runFfmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=20', '-c:v', 'mpeg4', '-q:v', '2', '-y', long])
    // Audio outlasts the picture, so the container says two seconds and the video has one.
    short = join(dir, 'short.mp4')
    await runFfmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:v', 'mpeg4', '-q:v', '2', '-y', short])
  }, 60_000)

  it('ends a decoder paused with a full pipe when it is restarted', async () => {
    await footageFrame('p-0', long, 100)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(liveDecoders()).toBe(1)

    await footageFrame('p-0', long, 10)

    // The old one is gone and the new one is the only one.
    await vi.waitFor(() => expect(liveDecoders()).toBe(1), { timeout: 5000 })
    closeReaders('p')
    await vi.waitFor(() => expect(liveDecoders()).toBe(0), { timeout: 5000 })
  }, 60_000)

  it('ends a paused decoder when its export is closed', async () => {
    await footageFrame('q-0', long, 100)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    closeReaders('q')
    await vi.waitFor(() => expect(liveDecoders()).toBe(0), { timeout: 5000 })
  }, 60_000)

  it('starts nothing for a reader whose export has closed', async () => {
    closeReaders('c')
    const before = decodersStarted()
    await expect(footageFrame('c-0', clip, 5)).rejects.toThrow(/closed/)
    expect(decodersStarted()).toBe(before)
  }, 60_000)

  it('holds the last frame when the decoder itself runs out of footage', async () => {
    await footageFrame('r-0', short, 25)
    const held = await footageFrame('r-0', short, 55)
    const last = await footageFrame('r-1', short, 29)
    expect(held).toEqual(last)
    closeReaders('r')
  }, 60_000)
})
