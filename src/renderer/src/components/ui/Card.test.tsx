import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from './Card'

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>content</Card>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('merges a custom className', () => {
    render(<Card data-testid="card" className="custom-class" />)
    expect(screen.getByTestId('card')).toHaveClass('custom-class')
  })
})
