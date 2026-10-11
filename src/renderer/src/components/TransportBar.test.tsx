import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TransportBar } from './TransportBar'

describe('the play controls', () => {
  it('keep their names, with Play filled in the accent', () => {
    render(<TransportBar playerRef={{ current: null }} timeline={[]} totalFrames={300} onSeek={() => {}} />)

    for (const name of ['Play', 'Previous clip', 'Next clip', 'Mute', 'Fullscreen']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Play' })).toHaveClass('bg-accent-fill', 'text-on-accent')
  })
})
