import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { installExamples } from '../../../examples/installExamples'
import { listProjects, readTimelineLenient } from '../../../project/projectApi'
import { renderProjectVideo } from '../../renderProject'
import { closeAssetServer } from '../../assetServer'
import { probeMedia } from '../../../media'
import { frameCount, integratedLoudness, pictureDifference, rgbFrame, silences } from './measure'

/**
 * The spec's proof that Talkie's own export can replace Remotion's: the same shipped examples,
 * exported both ways in one run, held to the limits in spec §3. A failure here is a difference
 * someone would see or hear — investigate it; never widen a limit to pass.
 */
const FIXTURES = ['Taskboard walkthrough', 'Where does a photo go?']
const SPEED_FIXTURE = 'Taskboard walkthrough'
const FRAME = 1 / 30

let home: string
const results = new Map<string, { remotion: string; own: string; remotionSeconds: number; ownSeconds: number }>()

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'talkie-compare-'))
  installExamples(home)
  for (const name of FIXTURES) {
    const project = listProjects(home).find((p) => p.name === name)
    if (!project) throw new Error(`The ${name} example did not install`)
    const timed = async (renderer: 'own' | 'remotion'): Promise<{ path: string; seconds: number }> => {
      const started = Date.now()
      const path = await renderProjectVideo(project.id, home, { renderer })
      const kept = path.replace(/\.mp4$/, `.${renderer}.mp4`)
      copyFileSync(path, kept)
      return { path: kept, seconds: (Date.now() - started) / 1000 }
    }
    const remotion = await timed('remotion')
    const own = await timed('own')
    results.set(name, { remotion: remotion.path, own: own.path, remotionSeconds: remotion.seconds, ownSeconds: own.seconds })
    console.log(`${name}: Remotion ${remotion.seconds.toFixed(1)} s, ${statSync(remotion.path).size} bytes; own ${own.seconds.toFixed(1)} s, ${statSync(own.path).size} bytes`)
  }
})
afterAll(async () => {
  await closeAssetServer()
  // Kept on request, because a failure here is investigated by looking at the two files.
  if (process.env.TALKIE_COMPARE_KEEP === '1') console.log(`Exports kept in ${home}`)
  else rmSync(home, { recursive: true, force: true })
})

describe.each(FIXTURES)('%s, exported both ways', (name) => {
  it('has the same frames and the same length', async () => {
    const { remotion, own } = results.get(name)!
    const frames = { remotion: await frameCount(remotion), own: await frameCount(own) }
    const lengths = { remotion: (await probeMedia(remotion)).durationSeconds!, own: (await probeMedia(own)).durationSeconds }
    console.log(`${name}: frames ${JSON.stringify(frames)}, length ${JSON.stringify(lengths)}`)
    expect(frames.own).toBe(frames.remotion)
    expect(lengths.own).toBeCloseTo(lengths.remotion, 1)
  })

  it('looks the same at five moments in every clip', async () => {
    const { remotion, own } = results.get(name)!
    const project = listProjects(home).find((p) => p.name === name)!
    const timeline = readTimelineLenient(project.id, home) as { start: number; duration: number }[]
    const measured: { seconds: number; mean: number; worstOutsideEdges: number }[] = []
    for (const clip of timeline) {
      for (let k = 1; k <= 5; k++) {
        const seconds = (clip.start + (clip.duration * k) / 6) / 30
        measured.push({ seconds, ...pictureDifference(await rgbFrame(remotion, seconds), await rgbFrame(own, seconds), 1920, 1080) })
      }
    }
    // Every moment measured before any is judged, so a failure reports the worst, not the first.
    const worstMean = measured.reduce((a, b) => (b.mean > a.mean ? b : a))
    const worstEdge = measured.reduce((a, b) => (b.worstOutsideEdges > a.worstOutsideEdges ? b : a))
    console.log(`${name}: worst mean ${worstMean.mean.toFixed(3)} at ${worstMean.seconds.toFixed(2)} s; worst outside edges ${worstEdge.worstOutsideEdges} at ${worstEdge.seconds.toFixed(2)} s`)
    for (const { seconds, mean, worstOutsideEdges } of measured) {
      expect(mean, `mean difference at ${seconds.toFixed(2)} s`).toBeLessThanOrEqual(3)
      expect(worstOutsideEdges, `worst difference at ${seconds.toFixed(2)} s`).toBeLessThanOrEqual(48)
    }
  })

  it('sounds the same: as loud, and quiet in the same places', async () => {
    const { remotion, own } = results.get(name)!
    const loudness = { remotion: await integratedLoudness(remotion), own: await integratedLoudness(own) }
    const theirs = await silences(remotion)
    const ours = await silences(own)
    console.log(`${name}: loudness ${JSON.stringify(loudness)}; silences Remotion ${JSON.stringify(theirs)}; own ${JSON.stringify(ours)}`)
    expect(Math.abs(loudness.own - loudness.remotion)).toBeLessThanOrEqual(0.5)
    expect(ours.length).toBe(theirs.length)
    ours.forEach((gap, i) => {
      expect(Math.abs(gap.start - theirs[i].start)).toBeLessThanOrEqual(2 * FRAME)
      if (Number.isFinite(gap.end) && Number.isFinite(theirs[i].end)) expect(Math.abs(gap.end - theirs[i].end)).toBeLessThanOrEqual(2 * FRAME)
    })
  })
})

describe('speed', () => {
  it(`exports ${SPEED_FIXTURE} in at most 1.2 times Remotion’s time`, () => {
    const { remotionSeconds, ownSeconds } = results.get(SPEED_FIXTURE)!
    expect(ownSeconds).toBeLessThanOrEqual(remotionSeconds * 1.2)
  })
})
