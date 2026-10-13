import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { inflateSync } from 'zlib'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../project/projectApi'
import { createTheme } from '../themes/themeApi'
import { defaultThemeDraft } from '../themes/schema'
import { setProjectTheme } from '../themes/applyTheme'
import { runFfmpeg } from '../media'
import { renderProjectVideo } from './renderProject'
import { closeAssetServer } from './assetServer'

/**
 * The average colour of a small patch of one frame, as [r, g, b].
 *
 * Shrunk to a single pixel and written as a PNG. That was chosen when Remotion's narrower ffmpeg
 * could not write raw pixels; Talkie's pinned build can, but the PNG works and is left alone. A
 * one-pixel PNG is one zlib stream holding a filter byte and three colour bytes — with no
 * neighbours, every PNG filter leaves them as they are.
 */
async function patchColour(video: string, seconds: number, dir: string): Promise<number[]> {
  const png = join(dir, 'patch.png')
  await runFfmpeg(['-ss', String(seconds), '-i', video, '-frames:v', '1', '-vf', 'crop=40:40:0:0,scale=1:1,format=rgb24', '-y', png])
  const bytes = readFileSync(png)
  const data: Buffer[] = []
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at)
    if (bytes.toString('ascii', at + 4, at + 8) === 'IDAT') data.push(bytes.subarray(at + 8, at + 8 + length))
    at += 12 + length
  }
  return [...inflateSync(Buffer.concat(data)).subarray(1, 4)]
}

describe('exporting a themed project', () => {
  let baseDir: string

  afterEach(async () => {
    await closeAssetServer()
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('opens on the theme’s own card, in its brand colour', async () => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-themed-export-'))
    const draft = { ...defaultThemeDraft('Acme'), company: 'Acme', tagline: 'Payments, simply' }
    draft.variants.brand.background = '#c0392b'
    const project = createProject('Launch video', baseDir)
    setProjectTheme(project.id, createTheme(draft, baseDir).id, baseDir)

    const video = await renderProjectVideo(project.id, baseDir)

    // H.264's colour conversion moves a flat colour a few units on its way in and out, so this
    // asks the question that matters: is the card the brand colour, rather than one of the others?
    const seen = await patchColour(video, 1, baseDir)
    const distance = (hex: string): number =>
      Math.hypot(...[0, 1, 2].map((i) => seen[i] - parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)))

    expect(distance('#c0392b')).toBeLessThan(25)
    expect(distance('#c0392b')).toBeLessThan(distance(draft.variants.dark.background))
    expect(distance('#c0392b')).toBeLessThan(distance(draft.variants.light.background))
  }, 240_000)
})
