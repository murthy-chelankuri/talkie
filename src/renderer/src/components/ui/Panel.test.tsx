import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Panel } from './Panel'

describe('Panel', () => {
  it('renders title and children', () => {
    render(<Panel title="Sources">child content</Panel>)
    expect(screen.getByText('Sources')).toBeInTheDocument()
    expect(screen.getByText('child content')).toBeInTheDocument()
  })

  it('does not render a collapse toggle when not collapsible', () => {
    render(<Panel title="Sources">child content</Panel>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('collapses and expands when the toggle is clicked', async () => {
    const user = userEvent.setup()
    render(
      <Panel title="Sources" collapsible>
        child content
      </Panel>
    )
    expect(screen.getByText('child content')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Collapse Sources' }))
    expect(screen.queryByText('child content')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand Sources' }))
    expect(screen.getByText('child content')).toBeInTheDocument()
  })

  it('starts collapsed when defaultCollapsed is true', () => {
    render(
      <Panel title="Sources" collapsible defaultCollapsed>
        child content
      </Panel>
    )
    expect(screen.queryByText('child content')).not.toBeInTheDocument()
  })
})
