import { describe, expect, it } from 'vitest'
import { createClock } from './clock'

function fakeWindow(): any {
  return { requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, setTimeout, clearTimeout, setInterval, clearInterval, performance: { now: () => 0 }, Date }
}

describe('a scene’s clock', () => {
  it('tells the video’s time, not the wall’s', () => {
    const win = fakeWindow(); const clock = createClock(); clock.install(win)
    clock.advanceTo(4000)
    expect(win.performance.now()).toBe(4000)
    expect(win.Date.now() - clock.epoch).toBe(4000)
  })

  it('runs timers when the video reaches them, in order, and repeats intervals', () => {
    const win = fakeWindow(); const clock = createClock(); clock.install(win)
    const seen: string[] = []
    win.setTimeout(() => seen.push('b'), 200)
    win.setTimeout(() => seen.push('a'), 100)
    win.setInterval(() => seen.push('i'), 150)
    clock.advanceTo(320)
    expect(seen).toEqual(['a', 'i', 'b', 'i'])
  })

  it('draws animation frames with the video’s timestamp', () => {
    const win = fakeWindow(); const clock = createClock(); clock.install(win)
    const stamps: number[] = []
    const loop = (t: number): void => { stamps.push(t); win.requestAnimationFrame(loop) }
    win.requestAnimationFrame(loop)
    clock.advanceTo(1000 / 30)
    clock.advanceTo(2000 / 30)
    expect(stamps).toEqual([1000 / 30, 2000 / 30])
  })

  it('lands time-based motion on the same place whichever frame came before', () => {
    const run = (frames: number[]): number => {
      const win = fakeWindow(); const clock = createClock(); clock.install(win)
      let x = 0
      const loop = (t: number): void => { x = (t / 1000) * 100; win.requestAnimationFrame(loop) }
      win.requestAnimationFrame(loop)
      for (const f of frames) clock.advanceTo((f * 1000) / 30)
      return x
    }
    expect(run([120])).toBe(run([0, 60, 119, 120]))
  })
})
