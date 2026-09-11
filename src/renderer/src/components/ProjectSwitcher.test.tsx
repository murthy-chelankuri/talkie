import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectSwitcher } from './ProjectSwitcher'
import { projectClient } from '../api/projectClient'

vi.mock('../api/projectClient', () => ({
  projectClient: { list: vi.fn() }
}))

const mockedList = vi.mocked(projectClient.list)

function renderSwitcher(overrides: { onSwitch?: () => void; onExit?: () => void } = {}) {
  const onSwitch = vi.fn()
  const onExit = vi.fn()
  render(
    <ProjectSwitcher
      currentProjectId="p1"
      currentProjectName="Checkout demo"
      onSwitch={overrides.onSwitch ?? onSwitch}
      onExit={overrides.onExit ?? onExit}
    />
  )
  return { onSwitch, onExit }
}

describe('ProjectSwitcher', () => {
  beforeEach(() => {
    mockedList.mockReset()
    mockedList.mockResolvedValue([
      { id: 'p1', name: 'Checkout demo', createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'p2', name: 'Onboarding tour', createdAt: '2026-09-02T00:00:00.000Z' }
    ])
  })

  it('names the open project without opening the menu', () => {
    renderSwitcher()
    expect(screen.getByRole('button', { name: /Checkout demo/ })).toBeInTheDocument()
    expect(mockedList).not.toHaveBeenCalled()
  })

  it('lists the other projects when opened', async () => {
    const user = userEvent.setup()
    renderSwitcher()

    await user.click(screen.getByRole('button', { name: /Checkout demo/ }))

    expect(await screen.findByRole('menuitem', { name: /Onboarding tour/ })).toBeInTheDocument()
  })

  it('switches to the project that was picked', async () => {
    const user = userEvent.setup()
    const { onSwitch } = renderSwitcher()

    await user.click(screen.getByRole('button', { name: /Checkout demo/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Onboarding tour/ }))

    expect(onSwitch).toHaveBeenCalledWith('p2')
  })

  it('goes back to the launcher', async () => {
    const user = userEvent.setup()
    const { onExit } = renderSwitcher()

    await user.click(screen.getByRole('button', { name: /Checkout demo/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'All projects' }))

    expect(onExit).toHaveBeenCalled()
  })

  it('closes on Escape without switching', async () => {
    const user = userEvent.setup()
    const { onSwitch, onExit } = renderSwitcher()

    await user.click(screen.getByRole('button', { name: /Checkout demo/ }))
    await screen.findByRole('menuitem', { name: /Onboarding tour/ })
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onSwitch).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
  })
})
