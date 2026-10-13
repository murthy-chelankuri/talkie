// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { render } from '@testing-library/react'

/** Stands in for Remotion's player and records what was asked of it. */
const calls: unknown[][] = []
const fakePlayer = {
  seekTo: (frame: number) => calls.push(['seekTo', frame]),
  getCurrentFrame: () => 42,
  toggle: () => calls.push(['toggle']),
  isPlaying: () => true,
  mute: () => calls.push(['mute']),
  unmute: () => calls.push(['unmute']),
  isMuted: () => false,
  requestFullscreen: () => calls.push(['requestFullscreen']),
  addEventListener: (event: string, listener: unknown) => calls.push(['add', event, listener]),
  removeEventListener: (event: string, listener: unknown) => calls.push(['remove', event, listener])
}
vi.mock('@remotion/player', () => ({
  Player: forwardRef(function Player(props: { controls?: boolean; loop?: boolean }, ref) {
    useImperativeHandle(ref, () => fakePlayer)
    return <div data-testid="player" data-controls={String(!!props.controls)} data-loop={String(!!props.loop)} />
  })
}))

const { Preview } = await import('./preview')
type Handle = import('./preview').PreviewHandle

function mount(extra: { controls?: boolean; loop?: boolean } = {}) {
  const ref = createRef<Handle>()
  const view = render(
    <Preview ref={ref} component={() => null} inputProps={{}} durationInFrames={90} fps={30} width={1920} height={1080} {...extra} />
  )
  return { ref, view }
}

describe('the preview', () => {
  it('answers the transport, timeline and script as the player did', () => {
    const { ref } = mount()
    ref.current!.seekTo(12)
    ref.current!.toggle()
    ref.current!.mute()
    ref.current!.unmute()
    ref.current!.requestFullscreen()

    expect(ref.current!.getCurrentFrame()).toBe(42)
    expect(ref.current!.isPlaying()).toBe(true)
    expect(ref.current!.isMuted()).toBe(false)
    expect(calls).toEqual(expect.arrayContaining([['seekTo', 12], ['toggle'], ['mute'], ['unmute'], ['requestFullscreen']]))
  })

  it('tells listeners about frames, play and pause, and stops when they leave', () => {
    const { ref } = mount()
    const onFrame = (_event: { detail: { frame: number } }): void => undefined
    ref.current!.addEventListener('frameupdate', onFrame)
    ref.current!.removeEventListener('frameupdate', onFrame)

    expect(calls).toEqual(expect.arrayContaining([['add', 'frameupdate', onFrame], ['remove', 'frameupdate', onFrame]]))
  })

  it('shows its own controls and loops where a panel asks for that', () => {
    const { view } = mount({ controls: true, loop: true })

    expect(view.getByTestId('player').dataset).toMatchObject({ controls: 'true', loop: 'true' })
  })
})
