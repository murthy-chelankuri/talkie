import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PreviewHandle } from '../../../video/preview'
import type { TimelineItem } from '../api/projectClient'
import { TransportBar } from './TransportBar'

describe('the play controls', () => {
  it('keep their names, with Play filled in the accent', () => {
    render(<TransportBar playerRef={{ current: null }} timeline={[]} sceneOrder={[]} totalFrames={300} onSeek={() => {}} />)

    for (const name of ['Play', 'Previous clip', 'Next clip', 'Mute', 'Fullscreen']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Play' })).toHaveClass('bg-accent-fill', 'text-on-accent')
  })
})

function fakePlayer(): PreviewHandle & { emit: (frame: number) => void } {
  const listeners: Array<(event: { detail: { frame: number } }) => void> = []
  let frame = 0
  return {
    seekTo: () => {},
    getCurrentFrame: () => frame,
    toggle: () => {},
    isPlaying: () => false,
    mute: () => {},
    unmute: () => {},
    isMuted: () => false,
    requestFullscreen: () => {},
    addEventListener: ((event: string, listener: never) => {
      if (event === 'frameupdate') listeners.push(listener)
    }) as PreviewHandle['addEventListener'],
    removeEventListener: () => {},
    emit: (next) => {
      frame = next
      listeners.forEach((listener) => listener({ detail: { frame: next } }))
    }
  }
}

describe('the scene clock', () => {
  // Scene 2 is left out of this version, so the second scene played is the script's Scene 3.
  const played = [
    { id: 'one', kind: 'slide', start: 0, duration: 150, data: {} },
    { id: 'three', kind: 'slide', start: 150, duration: 360, data: {} }
  ] as TimelineItem[]
  const order = ['one', 'two', 'three']

  it('shows how far into its scene the playhead is, numbered as the script numbers it', () => {
    const player = fakePlayer()
    render(<TransportBar playerRef={{ current: player }} timeline={played} sceneOrder={order} totalFrames={510} onSeek={() => {}} />)

    act(() => player.emit(276))

    expect(screen.getByLabelText('Time in this scene')).toHaveTextContent('Scene 3 · 4.2 / 12.0s')
  })

  it('copies the moment as a timing to start a narration line with', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const player = fakePlayer()
    render(<TransportBar playerRef={{ current: player }} timeline={played} sceneOrder={order} totalFrames={510} onSeek={() => {}} />)

    act(() => player.emit(276))
    await user.click(screen.getByRole('button', { name: 'Copy this moment as a narration timing' }))

    expect(writeText).toHaveBeenCalledWith('[4.2] ')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })
})
