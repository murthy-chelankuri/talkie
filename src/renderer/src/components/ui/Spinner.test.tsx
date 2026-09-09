import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Spinner } from './Spinner'

describe('Spinner', () => {
  it('exposes a status role with the default label', () => {
    render(<Spinner />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('exposes a custom label', () => {
    render(<Spinner label="Exporting…" />)
    expect(screen.getByRole('status', { name: 'Exporting…' })).toBeInTheDocument()
  })
})
