import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Toolbar } from './Toolbar'

describe('Toolbar', () => {
  it('exposes a toolbar role', () => {
    render(<Toolbar>content</Toolbar>)
    expect(screen.getByRole('toolbar')).toBeInTheDocument()
  })

  it('renders its children', () => {
    render(<Toolbar>content</Toolbar>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
