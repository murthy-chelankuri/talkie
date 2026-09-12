import { describe, expect, it } from 'vitest'
import { peaksFrom } from './waveform'

/**
 * The reduction from a take to a picture of it. Everything else in this module is fetching and
 * caching; this is the part that decides whether the drawing says anything true.
 */
describe('reducing a take to bars', () => {
  it('gives back exactly as many bars as asked for', () => {
    expect(peaksFrom(new Float32Array(1000), 56)).toHaveLength(56)
  })

  it('draws nothing for silence', () => {
    expect(peaksFrom(new Float32Array(100), 10).every((peak) => peak === 0)).toBe(true)
  })

  it('takes the loudest moment in a bucket, not the average', () => {
    // A speech waveform averages out to near silence everywhere, which would draw a flat line
    // and say nothing about where the words are.
    const samples = new Float32Array(10)
    samples[3] = 1

    const [first, second] = peaksFrom(samples, 2)
    expect(first).toBe(1)
    expect(second).toBe(0)
  })

  it('ignores the sign, since a trough is as loud as a peak', () => {
    const samples = new Float32Array([0, -1, 0, 0])

    expect(peaksFrom(samples, 1)[0]).toBe(1)
  })

  it('scales a quiet take up so it is still legible', () => {
    const quiet = new Float32Array([0.05, 0.025, 0.05, 0.0125])

    const peaks = peaksFrom(quiet, 2)
    expect(Math.max(...peaks)).toBe(1)
  })

  it('keeps the relative shape while scaling', () => {
    const samples = new Float32Array([1, 0.5])

    expect(peaksFrom(samples, 2)).toEqual([1, 0.5])
  })

  it('copes with fewer samples than buckets', () => {
    // A very short take must not produce NaN or a ragged array.
    const peaks = peaksFrom(new Float32Array([1, 0.5]), 8)

    expect(peaks).toHaveLength(8)
    expect(peaks.every((peak) => Number.isFinite(peak))).toBe(true)
  })

  it('copes with no samples at all', () => {
    const peaks = peaksFrom(new Float32Array(0), 4)

    expect(peaks).toHaveLength(4)
    expect(peaks.every((peak) => peak === 0)).toBe(true)
  })
})
