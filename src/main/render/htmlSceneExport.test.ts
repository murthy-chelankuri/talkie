import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { inflateSync } from 'zlib'
import { tmpdir } from 'os'
import { join } from 'path'
import { addTimelineItem, createProject } from '../project/projectApi'
import { writeRevision } from '../htmlScene/store'
import { GOOD, SILENT } from '../htmlScene/fixtures'
import { runFfmpeg } from '../media'
import { renderProjectVideo } from './renderProject'
import { closeAssetServer } from './assetServer'

/** The average colour of a 40-pixel patch of one frame, read with Talkie's pinned ffmpeg — see themedExport.test.ts for why a PNG. */
async function patchColour(video: string, seconds: number, x: number, y: number, dir: string): Promise<number[]> {
  const png = join(dir, 'patch.png')
  await runFfmpeg(['-ss', String(seconds), '-i', video, '-frames:v', '1', '-vf', `crop=40:40:${x}:${y},scale=1:1,format=rgb24`, '-y', png])
  const bytes = readFileSync(png)
  const data: Buffer[] = []
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at)
    if (bytes.toString('ascii', at + 4, at + 8) === 'IDAT') data.push(bytes.subarray(at + 8, at + 8 + length))
    at += 12 + length
  }
  return [...inflateSync(Buffer.concat(data)).subarray(1, 4)]
}

describe('exporting an HTML scene', () => {
  let baseDir: string
  const wasIn = process.cwd()

  afterEach(async () => {
    process.chdir(wasIn)
    await closeAssetServer()
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('draws the page at the video’s moment, from anywhere the app is started', async () => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-html-export-'))
    const project = createProject('Revenue', baseDir)
    const src = writeRevision(project.id, { 'index.html': GOOD }, { baseDir })
    addTimelineItem(project.id, { kind: 'html', start: 0, duration: 90, data: { src, title: 'Revenue' } }, baseDir)
    // A packaged app is started from / — see exportFromAnywhere.test.ts.
    process.chdir('/')

    const video = await renderProjectVideo(project.id, baseDir)

    // The bar grows from x=120 to 1320 over two seconds. A patch at x=900 is covered from about
    // 1.3 s; drawn by the wall clock rather than the video's, it would be whatever the render
    // happened to catch.
    if (process.env.TALKIE_FRAME_OUT) await runFfmpeg(['-ss', '1.7', '-i', video, '-frames:v', '1', '-y', process.env.TALKIE_FRAME_OUT])
    const early = await patchColour(video, 0.5, 900, 370, baseDir)
    const later = await patchColour(video, 1.7, 900, 370, baseDir)
    const near = (seen: number[], hex: string): boolean =>
      Math.hypot(...[0, 1, 2].map((i) => seen[i] - parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16))) < 30
    // With no theme the scene is in Talkie's own dark look: graphite ground, azure accent.
    expect(near(early, '#171b22')).toBe(true)
    expect(near(later, '#7ab5f0')).toBe(true)
  }, 300_000)

  it('still exports when a page never finishes a frame', async () => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-html-export-'))
    const project = createProject('Stuck', baseDir)
    const src = writeRevision(project.id, { 'index.html': SILENT }, { baseDir })
    addTimelineItem(project.id, { kind: 'html', start: 0, duration: 6, data: { src, title: 'Stuck' } }, baseDir)

    expect(await renderProjectVideo(project.id, baseDir)).toMatch(/\.mp4$/)
  }, 300_000)
})
