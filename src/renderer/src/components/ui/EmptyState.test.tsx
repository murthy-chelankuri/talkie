import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No projects yet" />)
    expect(screen.getByText('No projects yet')).toBeInTheDocument()
  })

  it('renders the description when provided', () => {
    render(<EmptyState title="No projects yet" description="Create your first one to get started." />)
    expect(screen.getByText('Create your first one to get started.')).toBeInTheDocument()
  })

  it('does not render a description when omitted', () => {
    render(<EmptyState title="No projects yet" />)
    expect(screen.queryByText(/get started/)).not.toBeInTheDocument()
  })

  it('renders the action when provided', () => {
    render(<EmptyState title="No projects yet" action={<button>New Project</button>} />)
    expect(screen.getByRole('button', { name: 'New Project' })).toBeInTheDocument()
  })
})
