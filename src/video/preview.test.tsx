// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { act, render } from '@testing-library/react'
import { Preview, type PreviewHandle } from './preview'

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

  it('shows its own controls where a panel asks for them', () => {
    const { view } = mount({ controls: true })
    expect(view.getByRole('button', { name: 'Play' })).toBeTruthy()
    expect(view.getByRole('slider', { name: 'Seek' })).toBeTruthy()
  })
})
