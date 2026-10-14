import { describe, expect, it } from 'vitest'
import { splitFrames, tabCount } from './ranges'

describe('sharing the frames out between tabs', () => {
  it('uses half the cores, at least one tab and at most six', () => {
    expect(tabCount(10)).toBe(5)
    expect(tabCount(1)).toBe(1)
    expect(tabCount(32)).toBe(6)
  })

  it('gives each tab one run of consecutive frames, covering the video exactly once', () => {
    const ranges = splitFrames(1711, 5)
    expect(ranges[0].from).toBe(0)
    expect(ranges.at(-1)!.to).toBe(1711)
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].from).toBe(ranges[i - 1].to)
    expect(Math.max(...ranges.map((r) => r.to - r.from)) - Math.min(...ranges.map((r) => r.to - r.from))).toBeLessThanOrEqual(1)
  })

  it('never makes an empty range for a video shorter than the tabs', () => {
    expect(splitFrames(3, 5)).toEqual([{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }])
  })
})
