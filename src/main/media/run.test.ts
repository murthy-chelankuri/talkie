import { describe, expect, it } from 'vitest'
import { runFfmpeg, runFfprobe, spawnFfmpeg } from './run'

describe('running ffmpeg', () => {
  it('runs the pinned build and hands back what it printed', async () => {
    const { stdout } = await runFfmpeg(['-hide_banner', '-version'])

    expect(stdout).toMatch(/^ffmpeg version 9\.0\.2/)
  }, 60_000)

  it('runs ffprobe from the same build', async () => {
    const { stdout } = await runFfprobe(['-hide_banner', '-version'])

    expect(stdout).toMatch(/^ffprobe version 9\.0\.2/)
  }, 60_000)

  it('fails with what ffmpeg said, so a broken encode explains itself', async () => {
    await expect(runFfmpeg(['-i', '/no/such/file.mp4', '-f', 'null', '-'])).rejects.toThrow(/No such file or directory/)
  }, 60_000)

  it('stops when asked to, so a cancelled job does not wait on ffmpeg', async () => {
    const controller = new AbortController()
    const run = runFfmpeg(['-f', 'lavfi', '-i', 'anullsrc', '-f', 'null', '-'], { signal: controller.signal })
    setTimeout(() => controller.abort(), 200)

    await expect(run).rejects.toThrow()
  }, 60_000)
})

describe('streaming through ffmpeg', () => {
  it('takes input on stdin and finishes when it ends', async () => {
    const running = spawnFfmpeg(['-f', 's16le', '-ar', '8000', '-ac', '1', '-i', 'pipe:0', '-f', 'null', '-'])
    running.process.stdin.end(Buffer.alloc(16_000))
    await expect(running.done).resolves.toBeUndefined()
  }, 60_000)

  it('fails with what ffmpeg said when it exits badly', async () => {
    const running = spawnFfmpeg(['-i', '/no/such/file.mp4', '-f', 'null', '-'])
    await expect(running.done).rejects.toThrow(/No such file or directory/)
  }, 60_000)
})
