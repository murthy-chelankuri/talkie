import { describe, expect, it } from 'vitest'
import {
  chooseTickIntervalSeconds,
  formatSceneSeconds,
  formatTimecode,
  sceneAt,
  frameAtOffset,
  nextClipStart,
  offsetAtFrame,
  previousClipStart
} from './timelineLayout'

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

describe('previousClipStart', () => {
  const clips = [
    { start: 0, duration: 60 },
    { start: 60, duration: 90 },
    { start: 150, duration: 30 }
  ]

  it('rewinds to the start of the clip being played', () => {
    expect(previousClipStart(clips, 100)).toBe(60)
  })

  it('steps to the clip before when already at a clip start', () => {
    expect(previousClipStart(clips, 60)).toBe(0)
  })

  it('has nowhere to go from the very beginning', () => {
    expect(previousClipStart(clips, 0)).toBeNull()
  })

  it('has nowhere to go with no clips', () => {
    expect(previousClipStart([], 10)).toBeNull()
  })
})

describe('nextClipStart', () => {
  const clips = [
    { start: 0, duration: 60 },
    { start: 60, duration: 90 },
    { start: 150, duration: 30 }
  ]

  it('skips to the next clip', () => {
    expect(nextClipStart(clips, 10)).toBe(60)
    expect(nextClipStart(clips, 60)).toBe(150)
  })

  it('has nowhere to go from the last clip', () => {
    expect(nextClipStart(clips, 150)).toBeNull()
  })
})

describe('the scene clock', () => {
  const clips = [
    { id: 'b', start: 150, duration: 300 },
    { id: 'a', start: 0, duration: 150 }
  ]

  it('counts from the start of the scene the frame is in, not from the start of the video', () => {
    expect(sceneAt(clips, 276)).toEqual({ clip: clips[0], offset: 126, duration: 300 })
    expect(sceneAt(clips, 0)?.clip.id).toBe('a')
    expect(sceneAt(clips, 150)?.clip.id).toBe('b')
  })

  it('finds no scene in a gap or past the end', () => {
    expect(sceneAt([{ start: 0, duration: 30 }, { start: 60, duration: 30 }], 45)).toBeNull()
    expect(sceneAt(clips, 450)).toBeNull()
  })

  it('reads in tenths of a second, as a timing in the narration is written, never ahead of the picture', () => {
    expect(formatSceneSeconds(4.2)).toBe('4.2')
    expect(formatSceneSeconds(4.29)).toBe('4.2')
    expect(formatSceneSeconds(12)).toBe('12.0')
  })
})
