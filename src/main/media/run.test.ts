import { describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
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

  it('has stopped ffmpeg by the time a cancelled run says so, so its files can be cleared away', async () => {
    const controller = new AbortController()
    const run = runFfmpeg(['-f', 'lavfi', '-i', 'anullsrc', '-f', 'null', '-'], { signal: controller.signal })
    setTimeout(() => controller.abort(), 200)
    await expect(run).rejects.toThrow()

    const children = spawnSync('ps', ['-A', '-o', 'ppid=,stat=,command='], { encoding: 'utf-8' })
      .stdout.split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter(([ppid, stat, command]) => ppid === String(process.pid) && !stat?.startsWith('Z') && /ffmpeg/.test(command ?? ''))
    expect(children).toEqual([])
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
