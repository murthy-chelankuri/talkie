import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { addTimelineItem, createProject, readTimelineLenient } from '../../project/projectApi'
import { findProjectDir, projectsRootDir } from '../../project/paths'
import { probeMedia, runFfprobe } from '../../media'
import { closeAssetServer, getAssetServer, resolveTimelineAssetUrls } from '../assetServer'
import type { TimelineItem } from '../../../remotion/types'
import type { ExportProgress } from '../exportProgress'
import { decodersStarted, liveDecoders } from './frameSource'
import { exportVideo, type OwnExportInput } from './exportVideo'

let baseDir: string
afterEach(async () => {
  await closeAssetServer()
  rmSync(baseDir, { recursive: true, force: true })
})

async function twoClips(): Promise<Omit<OwnExportInput, 'outputPath'>> {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-own-export-'))
  const project = createProject('Two clips', baseDir)
  addTimelineItem(project.id, { kind: 'scene', start: 0, duration: 45, data: { title: 'First', bullets: ['One'] } } as never, baseDir)
  addTimelineItem(project.id, { kind: 'scene', start: 45, duration: 45, data: { title: 'Second', bullets: ['Two'] } } as never, baseDir)
  const root = projectsRootDir(baseDir)
  const server = await getAssetServer(root)
  const rawTimeline = readTimelineLenient(project.id, baseDir) as unknown as TimelineItem[]
  const timeline = resolveTimelineAssetUrls(rawTimeline, root, server.url)
  return { timeline, rawTimeline, theme: null, totalFrames: 90, narration: new Map(), serverUrl: server.url }
}

/**
 * This test process's own children that are an ffmpeg or a browser and still running — what an
 * export starts. One that has exited but not yet been reaped (state Z) is not running.
 */
const runningChildren = (): string[] =>
  spawnSync('ps', ['-A', '-o', 'ppid=,stat=,command='], { encoding: 'utf-8' })
    .stdout.split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([ppid, stat]) => ppid === String(process.pid) && !stat?.startsWith('Z'))
    .map((fields) => fields.slice(2).join(' '))
    .filter((command) => /vendor\/ffmpeg|headless_shell|chrome-headless|Chromium/.test(command))

const partsLeft = (): string[] => readdirSync(baseDir).filter((name) => name.startsWith('.parts-'))

describe('Talkie’s own export', () => {
  it('exports every frame to an H.264 file with a soundtrack, and tidies up after itself', async () => {
    const input = await twoClips()
    const out = join(baseDir, 'out.mp4')

    await exportVideo({ ...input, outputPath: out })

    const info = await probeMedia(out)
    expect(info).toMatchObject({ width: 1920, height: 1080, fps: 30, videoCodec: 'h264', hasAudio: true })
    expect(info.durationSeconds).toBeCloseTo(3, 1)
    const { stdout } = await runFfprobe(['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out])
    expect(stdout.trim()).toBe('90')
    // Described as HD colour, all four ways; ffmpeg 9 dropped primaries and transfer given as options.
    const colour = await runFfprobe(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space,color_primaries,color_transfer,color_range', '-of', 'csv=p=0', out])
    expect(colour.stdout.trim()).toBe('tv,bt709,bt709,bt709')
    expect(partsLeft()).toEqual([])
  }, 180_000)

  it('stops when cancelled, leaving nothing behind', async () => {
    const input = await twoClips()
    const decoders = decodersStarted()
    const cancel = new AbortController()
    const onProgress = (progress: ExportProgress): void => {
      if (progress.stage === 'rendering') cancel.abort()
    }

    const began = Date.now()
    await expect(exportVideo({ ...input, outputPath: join(baseDir, 'out.mp4'), onProgress, signal: cancel.signal })).rejects.toThrow()

    expect(Date.now() - began).toBeLessThan(15_000)
    expect(partsLeft()).toEqual([])
    expect(readdirSync(baseDir)).not.toContain('out.mp4')
    expect(decodersStarted()).toBe(decoders)
    expect(liveDecoders()).toBe(0)
    expect(runningChildren()).toEqual([])
  }, 180_000)
  it('fails as a whole when one tab cannot draw its frames, saying why and leaving nothing behind', async () => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-own-export-'))
    const project = createProject('Broken', baseDir)
    // A recording that is not there: the first tab fails on its first frame while the rest have
    // plenty still to draw, and must not be left drawing it.
    const missing = join(findProjectDir(project.id, baseDir)!, 'sources', 'gone.mp4')
    addTimelineItem(project.id, { kind: 'video', start: 0, duration: 30, data: { src: missing } } as never, baseDir)
    addTimelineItem(project.id, { kind: 'scene', start: 30, duration: 570, data: { title: 'Long', bullets: ['One'] } } as never, baseDir)
    const root = projectsRootDir(baseDir)
    const server = await getAssetServer(root)
    const rawTimeline = readTimelineLenient(project.id, baseDir) as unknown as TimelineItem[]
    const timeline = resolveTimelineAssetUrls(rawTimeline, root, server.url)

    await expect(
      exportVideo({ timeline, rawTimeline, theme: null, totalFrames: 600, narration: new Map(), serverUrl: server.url, outputPath: join(baseDir, 'out.mp4') })
    ).rejects.toThrow(/gone\.mp4/)

    expect(partsLeft()).toEqual([])
    expect(readdirSync(baseDir)).not.toContain('out.mp4')
    expect(liveDecoders()).toBe(0)
    expect(runningChildren()).toEqual([])
  }, 180_000)
})
