import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBanner } from './ErrorBanner'

describe('ErrorBanner', () => {
  it('renders the message with an alert role', () => {
    render(<ErrorBanner message="Something went wrong" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
  })
})
