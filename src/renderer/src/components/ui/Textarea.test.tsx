import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Textarea } from './Textarea'

describe('Textarea', () => {
  it('renders with a placeholder', () => {
    render(<Textarea placeholder="Narration text" />)
    expect(screen.getByPlaceholderText('Narration text')).toBeInTheDocument()
  })
})
