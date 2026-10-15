// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef, useEffect } from 'react'
import { act, render } from '@testing-library/react'
import { Preview, type PreviewHandle } from './preview'
import { usePreviewMediaRegister } from './own/previewMedia'

/**
 * Talkie's own preview player, driving the frame from elapsed time. The animation-frame loop and
 * the clock are stubbed so a test can step time by hand; what is checked is the handle and events
 * the editor uses (../preview.tsx) and the clock behaviours §4 of the spec names.
 */

let rafQueue: Array<() => void> = []
let now = 0

beforeEach(() => {
  rafQueue = []
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  // One frame is ever pending at a time (each tick schedules the next), so cancelling clears it.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafQueue.push(() => cb(now)))
  vi.stubGlobal('cancelAnimationFrame', () => void (rafQueue = []))
})
afterEach(() => vi.unstubAllGlobals())

/** Advance the wall clock by `ms` and run the animation frame that was waiting. */
function step(ms: number): void {
  now += ms
  const pending = rafQueue
  rafQueue = []
  act(() => pending.forEach((run) => run()))
}

/**
 * A narration take as a browser plays one, as far as the player can tell: it runs on the wall
 * clock while playing, ends at its duration, and — the part that matters — play() after it has
 * ended starts it again from the beginning.
 */
class FakeTake {
  currentTime = 0
  paused = true
  ended = false
  muted = false
  readyState = 4
  constructor(public duration: number) {}
  play(): Promise<void> {
    if (this.ended) {
      this.currentTime = 0
      this.ended = false
    }
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
  advance(seconds: number): void {
    if (this.paused) return
    this.currentTime = Math.min(this.duration, this.currentTime + seconds)
    if (this.currentTime >= this.duration) {
      this.ended = true
      this.paused = true
    }
  }
}

function mount(extra: { controls?: boolean; loop?: boolean } = {}, durationInFrames = 90) {
  const ref = createRef<PreviewHandle>()
  const view = render(
    <Preview ref={ref} component={() => null} inputProps={{}} durationInFrames={durationInFrames} fps={30} width={1920} height={1080} {...extra} />
  )
  return { ref, view, player: ref.current! }
}

describe('the preview player', () => {
  it('answers the transport, timeline and script the way they expect', () => {
    const { player } = mount()
    act(() => player.seekTo(12))
    expect(player.getCurrentFrame()).toBe(12)
    expect(player.isPlaying()).toBe(false)

    act(() => player.toggle())
    expect(player.isPlaying()).toBe(true)
    act(() => player.toggle())
    expect(player.isPlaying()).toBe(false)

    expect(player.isMuted()).toBe(false)
    act(() => player.mute())
    expect(player.isMuted()).toBe(true)
    act(() => player.unmute())
    expect(player.isMuted()).toBe(false)
  })

  it('tells listeners about frames, play and pause, and stops when they leave', () => {
    const { player } = mount()
    const frames: number[] = []
    const onFrame = (event: { detail: { frame: number } }): void => void frames.push(event.detail.frame)
    let plays = 0
    let pauses = 0
    const onPlay = (): void => void plays++
    const onPause = (): void => void pauses++
    player.addEventListener('frameupdate', onFrame)
    player.addEventListener('play', onPlay)
    player.addEventListener('pause', onPause)

    act(() => player.seekTo(5))
    act(() => player.toggle())
    expect(plays).toBe(1)
    act(() => player.toggle())
    expect(pauses).toBe(1)
    expect(frames).toContain(5)

    player.removeEventListener('frameupdate', onFrame)
    const seen = frames.length
    act(() => player.seekTo(9))
    expect(frames.length).toBe(seen)
  })

  it('advances the frame from elapsed time while playing', () => {
    const { player } = mount()
    act(() => player.toggle())
    step(100) // 0.1 s at 30 fps ≈ 3 frames
    expect(player.getCurrentFrame()).toBe(3)
    step(100)
    expect(player.getCurrentFrame()).toBe(6)
  })

  it('stops when paused, and does not advance after', () => {
    const { player } = mount()
    act(() => player.toggle())
    step(100)
    act(() => player.toggle())
    const held = player.getCurrentFrame()
    step(500)
    expect(player.getCurrentFrame()).toBe(held)
    expect(player.isPlaying()).toBe(false)
  })

  it('stops at the last frame when it reaches the end', () => {
    const { player } = mount()
    act(() => player.seekTo(80))
    act(() => player.toggle())
    step(500) // would run past frame 90
    expect(player.getCurrentFrame()).toBe(89)
    expect(player.isPlaying()).toBe(false)
  })

  it('loops back to the start instead of stopping where a panel asks for it', () => {
    const { player } = mount({ loop: true })
    act(() => player.seekTo(80))
    act(() => player.toggle())
    step(500)
    expect(player.getCurrentFrame()).toBe(0)
    expect(player.isPlaying()).toBe(true)
  })

  it('plays on past the end of a take that is shorter than its clip, rather than playing it again', () => {
    // Narration from frame 18 for one second, in a clip that runs to frame 90: the shape of nearly
    // every scene, a lead-in, the take, then a pause before the next.
    const take = new FakeTake(1)
    function Scene(): null {
      const register = usePreviewMediaRegister()
      useEffect(() => register({ el: take as unknown as HTMLMediaElement, kind: 'audio', startFrame: 18, endFrame: 90, trimBefore: 0 }), [register])
      return null
    }
    const ref = createRef<PreviewHandle>()
    render(<Preview ref={ref} component={Scene} inputProps={{}} durationInFrames={120} fps={30} width={1920} height={1080} />)
    const player = ref.current!

    act(() => player.seekTo(18))
    act(() => player.toggle())
    const seen: number[] = []
    for (let i = 0; i < 30; i++) {
      take.advance(0.1)
      step(100)
      seen.push(player.getCurrentFrame())
    }

    expect(seen.every((frame, i) => i === 0 || frame >= seen[i - 1]), `frames went backwards: ${seen.join(' ')}`).toBe(true)
    expect(player.getCurrentFrame()).toBeGreaterThanOrEqual(90)
  })

  it('shows its own controls where a panel asks for them', () => {
    const { view } = mount({ controls: true })
    expect(view.getByRole('button', { name: 'Play' })).toBeTruthy()
    expect(view.getByRole('slider', { name: 'Seek' })).toBeTruthy()
  })
})
