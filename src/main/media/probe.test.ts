import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { probeMedia } from './probe'
import { runFfmpeg } from './run'

let dir: string
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'talkie-probe-'))
  // mpeg4 and aac are FFmpeg's own encoders, present in any build, so the fixture needs nothing else.
  await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', '-y', join(dir, 'clip.mp4')])
  await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=25:duration=1', '-c:v', 'mpeg4', '-y', join(dir, 'silent.mp4')])
}, 60_000)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('measuring media', () => {
  it('reads a clip’s length, size, rate, codec and whether it has sound', async () => {
    const info = await probeMedia(join(dir, 'clip.mp4'))

    expect(info.durationSeconds).toBeCloseTo(2, 1)
    expect(info).toMatchObject({ width: 320, height: 240, fps: 30, videoCodec: 'mpeg4', hasAudio: true })
  }, 60_000)

  it('says a silent clip has no sound', async () => {
    expect((await probeMedia(join(dir, 'silent.mp4'))).hasAudio).toBe(false)
  }, 60_000)

  it('fails on something that is not media, rather than reporting it as empty', async () => {
    await expect(probeMedia(join(dir, 'missing.mp4'))).rejects.toThrow()
  }, 60_000)
})
