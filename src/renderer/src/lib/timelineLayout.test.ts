import { describe, expect, it } from 'vitest'
import { chooseTickIntervalSeconds, formatTimecode, frameAtOffset, offsetAtFrame } from './timelineLayout'

describe('chooseTickIntervalSeconds', () => {
  it('ticks every second when a second is wide enough to label', () => {
    expect(chooseTickIntervalSeconds(60)).toBe(1)
  })

  it('spreads ticks further apart when zoomed out', () => {
    expect(chooseTickIntervalSeconds(10)).toBe(10)
    expect(chooseTickIntervalSeconds(3)).toBe(30)
  })

  it('ticks every half second when zoomed right in', () => {
    expect(chooseTickIntervalSeconds(200)).toBe(0.5)
  })
})

describe('frameAtOffset', () => {
  it('converts a pixel offset into a frame at the current zoom', () => {
    expect(frameAtOffset(60, 60, 30, 300)).toBe(30)
    expect(frameAtOffset(30, 60, 30, 300)).toBe(15)
  })

  it('clamps to the timeline instead of running off either end', () => {
    expect(frameAtOffset(-100, 60, 30, 300)).toBe(0)
    expect(frameAtOffset(100_000, 60, 30, 300)).toBe(299)
  })

  it('returns 0 for an empty timeline', () => {
    expect(frameAtOffset(500, 60, 30, 0)).toBe(0)
  })
})

describe('offsetAtFrame', () => {
  it('is the inverse of frameAtOffset', () => {
    expect(offsetAtFrame(30, 60, 30)).toBe(60)
    expect(offsetAtFrame(0, 60, 30)).toBe(0)
  })
})

describe('formatTimecode', () => {
  it('formats seconds as m:ss', () => {
    expect(formatTimecode(0)).toBe('0:00')
    expect(formatTimecode(9)).toBe('0:09')
    expect(formatTimecode(75)).toBe('1:15')
    expect(formatTimecode(600)).toBe('10:00')
  })
})
