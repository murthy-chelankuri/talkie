import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from './Input'

describe('Input', () => {
  it('renders with a placeholder', () => {
    render(<Input placeholder="Project name" />)
    expect(screen.getByPlaceholderText('Project name')).toBeInTheDocument()
  })

  it('calls onChange as the user types', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input placeholder="Project name" onChange={onChange} />)
    await user.type(screen.getByPlaceholderText('Project name'), 'a')
    expect(onChange).toHaveBeenCalled()
  })
})
