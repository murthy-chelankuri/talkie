import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg } from '../../../media'
import { integratedLoudness, pictureDifference, silences } from './measure'

const W = 20
const H = 10

function grey(level: number): Buffer {
  return Buffer.alloc(W * H * 3, level)
}

describe('pictureDifference', () => {
  it('finds no difference between two identical pictures', () => {
    expect(pictureDifference(grey(128), grey(128), W, H)).toEqual({ mean: 0, worstOutsideEdges: 0 })
  })

  it('forgives a sharp edge one picture has and the other lacks, since edges are where renders differ', () => {
    const lined = grey(100)
    for (let y = 0; y < H; y++) lined.fill(255, (y * W + 10) * 3, (y * W + 11) * 3)
    expect(pictureDifference(grey(100), lined, W, H).worstOutsideEdges).toBe(0)
  })

  it('counts a shift across the whole picture in both the mean and the worst', () => {
    expect(pictureDifference(grey(100), grey(110), W, H)).toEqual({ mean: 10, worstOutsideEdges: 10 })
  })
})

describe('the sound measures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-measure-test-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('find the silences either side of a tone, and how loud the tone is', async () => {
    const file = join(dir, 'tone.m4a')
    await runFfmpeg([
      '-v', 'error',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1',
      '-filter_complex', '[1:a]aformat=channel_layouts=stereo[s];[0:a][s][2:a]concat=n=3:v=0:a=1[out]',
      '-map', '[out]', '-c:a', 'aac', '-y', file
    ])
    const found = await silences(file)
    expect(found).toHaveLength(2)
    expect(found[0].start).toBeCloseTo(0, 1)
    expect(found[1].start).toBeCloseTo(2, 1)
    expect(Number.isFinite(await integratedLoudness(file))).toBe(true)
  }, 60_000)
})
