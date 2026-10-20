import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { addTimelineItem, createProject, readTimeline } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { probeMedia } from '../media'
import { appendPreparedVideo, prepareVideo } from './importVideo'
import { findFootageCuts, readFootageCuts } from './footageCuts'
import { FPS } from '../../composition/constants'
import { gatherClipEvidence } from '../agent/clipEvidence'
import { editedVideo } from './testVideos'

let dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-import-video-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('reading where a video could be cut', () => {
  it('finds the edit’s cuts and the pauses in its speech', async () => {
    const video = join(tempDir(), 'edited.mp4')
    await editedVideo(video)

    const cuts = await findFootageCuts(video, { hasAudio: true, startSeconds: 0 })

    expect(cuts.shotsMs.map((ms) => Math.round(ms / 100) / 10)).toEqual([6, 13])
    expect(cuts.pausesMs.map((ms) => Math.round(ms / 1000))).toEqual([9, 16])
  }, 90_000)

  it('reads times on the player’s clock, from zero, when the file’s own starts later', () => {
    const stderr = [
      '[Parsed_showinfo_4 @ 0x1] n:   0 pts:     60 pts_time:6.5     duration:      1',
      '[Parsed_freezedetect_2 @ 0x2] lavfi.freezedetect.freeze_end: 10.5',
      '[Parsed_silencedetect_0 @ 0x3] silence_end: 4.5 | silence_duration: 1'
    ].join('\n')

    expect(readFootageCuts(stderr, 0.5)).toEqual({ shotsMs: [6000], stillsEndMs: [10000], pausesMs: [3500] })
  })
})

describe('importing a video', () => {
  it('lands as one scene per shot, each a stretch of one copy in the project', async () => {
    const home = tempDir()
    const project = createProject('Imported', home)
    addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, home)
    const source = join(tempDir(), 'edited.mp4')
    await editedVideo(source)

    const prepared = await prepareVideo(project.id, source, home)
    const scenes = appendPreparedVideo(project.id, prepared, home)

    // The edit's own cuts, not the clock's: 6s, 7s and 8s.
    expect(scenes.map((scene) => scene.duration)).toEqual([6 * FPS, 7 * FPS, 8 * FPS])
    expect(scenes.map((scene) => scene.start)).toEqual([90, 90 + 6 * FPS, 90 + 13 * FPS])
    const data = scenes.map((scene) => scene.data as { src: string; trimBefore?: number; trimAfter?: number })
    expect(new Set(data.map((d) => d.src)).size).toBe(1)
    expect(data[0].src.startsWith(findProjectDir(project.id, home)!)).toBe(true)
    expect(data.map((d) => d.trimBefore ?? 0)).toEqual([0, 6 * FPS, 13 * FPS])
    expect(readTimeline(project.id, home)).toHaveLength(4)
  }, 90_000)

  it('gives whoever writes the words pictures of each scene, and no log it does not have', async () => {
    const home = tempDir()
    const project = createProject('Described', home)
    const source = join(tempDir(), 'edited.mp4')
    await editedVideo(source)
    const [, second] = appendPreparedVideo(project.id, await prepareVideo(project.id, source, home), home)

    const evidence = await gatherClipEvidence(project.id, second.id, home)
    try {
      expect(evidence.kind).toBe('video')
      expect(evidence.actions).toEqual([])
      expect(evidence.framePaths.length).toBeGreaterThan(0)
      for (const frame of evidence.framePaths) expect(existsSync(frame)).toBe(true)
    } finally {
      evidence.cleanup?.()
    }
  }, 90_000)

  it('plays an H.264 .mp4 as it is, without converting it', async () => {
    const home = tempDir()
    const project = createProject('As is', home)
    const source = join(tempDir(), 'edited.mp4')
    await editedVideo(source)

    const prepared = await prepareVideo(project.id, source, home)

    expect(prepared.path.endsWith('video.mp4')).toBe(true)
    expect((await probeMedia(prepared.path)).durationSeconds).toBeCloseTo((await probeMedia(source)).durationSeconds!, 1)
  }, 90_000)

  it('converts a video the editor cannot play, keeping where it cuts', async () => {
    const home = tempDir()
    const project = createProject('Converted', home)
    const source = join(tempDir(), 'edited.mov')
    await editedVideo(source, 'prores')

    const prepared = await prepareVideo(project.id, source, home)

    expect((await probeMedia(prepared.path)).videoCodec).toBe('h264')
    expect(prepared.scenes.map((scene) => Math.round(scene.durationMs / 1000))).toEqual([6, 7, 8])
  }, 120_000)

  it('refuses a file with no picture, and leaves nothing behind in the project', async () => {
    const home = tempDir()
    const project = createProject('Not a video', home)
    const source = join(tempDir(), 'notes.mp4')
    writeFileSync(source, 'not a video at all')

    await expect(prepareVideo(project.id, source, home)).rejects.toThrow('no video')

    const videos = join(findProjectDir(project.id, home)!, 'sources', 'videos')
    expect(existsSync(videos) ? readdirSync(videos) : []).toEqual([])
  }, 60_000)
})
