import { describe, expect, it } from 'vitest'
import { runFfmpeg, runFfprobe } from './run'

describe('running ffmpeg', () => {
  it('runs the pinned build and hands back what it printed', async () => {
    const { stdout } = await runFfmpeg(['-hide_banner', '-version'])

    expect(stdout).toMatch(/^ffmpeg version 9\.0\.2/)
  })

  it('runs ffprobe from the same build', async () => {
    const { stdout } = await runFfprobe(['-hide_banner', '-version'])

    expect(stdout).toMatch(/^ffprobe version 9\.0\.2/)
  })

  it('fails with what ffmpeg said, so a broken encode explains itself', async () => {
    await expect(runFfmpeg(['-i', '/no/such/file.mp4', '-f', 'null', '-'])).rejects.toThrow(/No such file or directory/)
  })

  it('stops when asked to, so a cancelled job leaves no ffmpeg behind', async () => {
    const controller = new AbortController()
    const run = runFfmpeg(['-f', 'lavfi', '-i', 'anullsrc', '-f', 'null', '-'], { signal: controller.signal })
    setTimeout(() => controller.abort(), 200)

    await expect(run).rejects.toThrow()
  }, 60_000)
})
