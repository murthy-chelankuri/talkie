import { describe, expect, it } from 'vitest'
import { interpolate, spring, type SpringConfig } from './motion'
import samples from './springSamples.json'

/**
 * Remotion's spring, sampled from remotion@4.0.522 while both were installed. Kept as data so
 * the motion of every slide can still be checked against what it was once Remotion is gone.
 */
type Sample = { fps: number; config: Partial<SpringConfig>; durationInFrames?: number; frames: [number, number][] }

describe('a spring', () => {
  for (const sample of samples as Sample[]) {
    it(`moves as Remotion's did for ${JSON.stringify(sample.config)} at ${sample.fps} fps over ${sample.durationInFrames ?? 'its own'} frames`, () => {
      for (const [frame, expected] of sample.frames) {
        expect(spring({ frame, fps: sample.fps, config: sample.config, durationInFrames: sample.durationInFrames })).toBeCloseTo(expected, 9)
      }
    })
  }

  it('has not started before its first frame', () => {
    expect(spring({ frame: -5, fps: 30, config: { damping: 200 } })).toBe(0)
  })

  it('is exactly at rest once its duration has passed', () => {
    expect(spring({ frame: 13, fps: 30, config: { damping: 200 }, durationInFrames: 12 })).toBe(1)
  })
})

describe('interpolate', () => {
  it('maps a value across a range in a straight line', () => {
    expect(interpolate(0.5, [0, 1], [10, 0])).toBe(5)
  })

  it('follows each segment of a range with several stops', () => {
    expect(interpolate(15, [0, 10, 20], [0, 100, 0])).toBe(50)
  })

  it('carries on past either end unless told to clamp, as Remotion did', () => {
    expect(interpolate(2, [0, 1], [0, 10])).toBe(20)
    expect(interpolate(-1, [0, 1], [0, 10])).toBe(-10)
  })

  it('stops at the ends when clamped', () => {
    expect(interpolate(2, [0, 1], [0, 10], { extrapolateRight: 'clamp' })).toBe(10)
    expect(interpolate(-1, [0, 1], [0, 10], { extrapolateLeft: 'clamp' })).toBe(0)
  })

  it('refuses ranges it cannot follow, rather than drawing something wrong', () => {
    expect(() => interpolate(0, [0, 1], [0, 1, 2])).toThrow()
    expect(() => interpolate(0, [0], [0])).toThrow()
    expect(() => interpolate(0, [1, 0], [0, 1])).toThrow()
  })
})
