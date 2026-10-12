import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell, TopBarActions } from './AppShell'

describe('AppShell', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('puts a screen\'s own actions in the top bar, before Settings', () => {
    render(
      <AppShell>
        <TopBarActions>
          <button type="button">Export video</button>
        </TopBarActions>
      </AppShell>
    )

    const slot = screen.getByTestId('top-bar-actions')
    expect(slot).toContainElement(screen.getByRole('button', { name: 'Export video' }))
    expect(slot.compareDocumentPosition(screen.getByRole('button', { name: 'Settings' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders its children', () => {
    render(
      <AppShell>
        <p>screen content</p>
      </AppShell>
    )
    expect(screen.getByText('screen content')).toBeInTheDocument()
  })

  it('toggles the theme when the toggle button is clicked', async () => {
    const user = userEvent.setup()
    render(
      <AppShell>
        <p>screen content</p>
      </AppShell>
    )
    const before = document.documentElement.dataset.theme
    await user.click(screen.getByRole('button', { name: /Switch to (light|dark) theme/ }))
    expect(document.documentElement.dataset.theme).not.toBe(before)
  })
})
