import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { probeMedia, runFfmpeg } from '../../media'
import { NARRATION_LEAD_IN_FRAMES } from '../../../composition/constants'
import { soundtrackArgs, takesFor } from './soundtrack'

let dir: string
beforeAll(() => void (dir = mkdtempSync(join(tmpdir(), 'talkie-soundtrack-'))))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('the soundtrack', () => {
  it('starts each take a beat into its clip and stops it at the clip’s end', () => {
    const takes = takesFor(
      [{ id: 'a', start: 0, duration: 90 }, { id: 'b', start: 90, duration: 60 }, { id: 'c', start: 150, duration: 30 }],
      new Map([['a', { path: '/a.wav' }], ['b', { path: '/b.wav' }]])
    )
    expect(takes).toEqual([
      { path: '/a.wav', startFrame: NARRATION_LEAD_IN_FRAMES, maxFrames: 90 - NARRATION_LEAD_IN_FRAMES },
      { path: '/b.wav', startFrame: 90 + NARRATION_LEAD_IN_FRAMES, maxFrames: 60 - NARRATION_LEAD_IN_FRAMES }
    ])
  })

  it('puts the voice where the picture is, for exactly the video’s length', async () => {
    await runFfmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-y', join(dir, 'long.wav')])
    const out = join(dir, 'track.m4a')
    // 4 s of clip, 0.6 s lead-in: the 5 s take is cut at 3.4 s of speech, ending at 4 s.
    await runFfmpeg(soundtrackArgs([{ path: join(dir, 'long.wav'), startFrame: 18, maxFrames: 102 }], 180, out))
    const { stderr } = await runFfmpeg(['-i', out, '-af', 'silencedetect=n=-45dB:d=0.2', '-f', 'null', '-'])
    const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]))
    const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))

    expect(ends[0]).toBeCloseTo(0.6, 1)
    expect(starts.at(-1)).toBeCloseTo(4, 1)
    expect((await probeMedia(out)).durationSeconds).toBeCloseTo(6, 1)
  }, 60_000)

  it('is a silent track of the right length when nothing is narrated', async () => {
    const out = join(dir, 'silent.m4a')
    await runFfmpeg(soundtrackArgs([], 90, out))

    expect((await probeMedia(out)).durationSeconds).toBeCloseTo(3, 1)
  }, 60_000)
})
