import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectBrowser } from './ProjectBrowser'
import { projectClient } from '../api/projectClient'

vi.mock('../api/projectClient', () => ({
  projectClient: {
    list: vi.fn(),
    create: vi.fn()
  }
}))

const mockedList = vi.mocked(projectClient.list)
const mockedCreate = vi.mocked(projectClient.create)

describe('ProjectBrowser', () => {
  beforeEach(() => {
    mockedList.mockReset()
    mockedCreate.mockReset()
  })

  it('shows a spinner while loading', () => {
    mockedList.mockReturnValue(new Promise(() => {}))
    render(<ProjectBrowser onOpen={vi.fn()} />)
    expect(screen.getByRole('status', { name: 'Loading projects' })).toBeInTheDocument()
  })

  it('shows an empty state when there are no projects', async () => {
    mockedList.mockResolvedValue([])
    render(<ProjectBrowser onOpen={vi.fn()} />)
    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
  })

  it('shows a grid of project cards with relative creation time', async () => {
    mockedList.mockResolvedValue([{ id: 'p1', name: 'My Project', createdAt: new Date().toISOString() }])
    render(<ProjectBrowser onOpen={vi.fn()} />)
    expect(await screen.findByRole('button', { name: /My Project/ })).toBeInTheDocument()
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('opens a project when its card is clicked', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    mockedList.mockResolvedValue([{ id: 'p1', name: 'My Project', createdAt: new Date().toISOString() }])
    render(<ProjectBrowser onOpen={onOpen} />)
    await user.click(await screen.findByRole('button', { name: /My Project/ }))
    expect(onOpen).toHaveBeenCalledWith('p1')
  })

  it('shows an error banner when loading fails', async () => {
    mockedList.mockRejectedValue(new Error('disk on fire'))
    render(<ProjectBrowser onOpen={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('disk on fire')
  })

  it('expands an inline create form when New Project is clicked, then creates a project', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    mockedList.mockResolvedValue([])
    mockedCreate.mockResolvedValue({ id: 'p2', name: 'Fresh', createdAt: new Date().toISOString(), schemaVersion: 1 })
    render(<ProjectBrowser onOpen={onOpen} />)

    await user.click(await screen.findByRole('button', { name: 'New Project' }))
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Fresh')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('p2'))
    expect(mockedCreate).toHaveBeenCalledWith('Fresh')
  })

  it('disables Create while the name is blank', async () => {
    const user = userEvent.setup()
    mockedList.mockResolvedValue([])
    render(<ProjectBrowser onOpen={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'New Project' }))
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('collapses the create form when Cancel is clicked', async () => {
    const user = userEvent.setup()
    mockedList.mockResolvedValue([])
    render(<ProjectBrowser onOpen={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'New Project' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'New Project' })).toBeInTheDocument()
  })
})
