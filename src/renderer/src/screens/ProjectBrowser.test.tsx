import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectBrowser } from './ProjectBrowser'
import { projectClient, type ProjectOverview } from '../api/projectClient'

vi.mock('../api/projectClient', () => ({
  projectClient: {
    overviews: vi.fn(),
    create: vi.fn(),
    remove: vi.fn()
  }
}))

const mockedOverviews = vi.mocked(projectClient.overviews)
const mockedCreate = vi.mocked(projectClient.create)
const mockedRemove = vi.mocked(projectClient.remove)

function overview(partial: Partial<ProjectOverview> = {}): ProjectOverview {
  return {
    id: 'p1',
    name: 'My Project',
    createdAt: new Date().toISOString(),
    clipCount: 2,
    durationFrames: 300,
    narratedCount: 1,
    ...partial
  }
}

describe('ProjectBrowser', () => {
  beforeEach(() => {
    mockedOverviews.mockReset()
    mockedCreate.mockReset()
    mockedRemove.mockReset()
  })

  it('shows a spinner while loading', () => {
    mockedOverviews.mockReturnValue(new Promise(() => {}))
    render(<ProjectBrowser onOpen={vi.fn()} />)
    expect(screen.getByRole('status', { name: 'Loading projects' })).toBeInTheDocument()
  })

  it('invites you to start when there are no projects', async () => {
    mockedOverviews.mockResolvedValue([])
    render(<ProjectBrowser onOpen={vi.fn()} />)
    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
  })

  it('shows each project with its length, clips and narration progress', async () => {
    mockedOverviews.mockResolvedValue([overview()])
    render(<ProjectBrowser onOpen={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Open My Project' })).toBeInTheDocument()
    expect(screen.getByText('0:10')).toBeInTheDocument()
    expect(screen.getByText('2 clips')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('marks a project whose clips are all voiced', async () => {
    mockedOverviews.mockResolvedValue([overview({ narratedCount: 2 })])
    render(<ProjectBrowser onOpen={vi.fn()} />)
    expect(await screen.findByText('Voiced')).toBeInTheDocument()
  })

  it('opens a project when its card is clicked', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    mockedOverviews.mockResolvedValue([overview()])
    render(<ProjectBrowser onOpen={onOpen} />)

    await user.click(await screen.findByRole('button', { name: 'Open My Project' }))

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it('shows an error banner when loading fails', async () => {
    mockedOverviews.mockRejectedValue(new Error('disk on fire'))
    render(<ProjectBrowser onOpen={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('disk on fire')
  })

  it('creates a project and opens it', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    mockedOverviews.mockResolvedValue([])
    mockedCreate.mockResolvedValue({
      id: 'p2',
      name: 'Fresh',
      createdAt: new Date().toISOString(),
      schemaVersion: 1
    })
    render(<ProjectBrowser onOpen={onOpen} />)

    await user.click(await screen.findByRole('button', { name: 'New project' }))
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Fresh')
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' })))
    // Nothing described, so nothing is stored — a project is not given an empty description.
    expect(mockedCreate).toHaveBeenCalledWith('Fresh', undefined)
  })

  it('keeps what you said the project is about, asked while you are thinking about it', async () => {
    const user = userEvent.setup()
    mockedOverviews.mockResolvedValue([])
    mockedCreate.mockResolvedValue({
      id: 'p3',
      name: 'Acme',
      createdAt: new Date().toISOString(),
      schemaVersion: 1
    })
    render(<ProjectBrowser onOpen={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'New project' }))
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Acme')
    await user.type(
      screen.getByRole('textbox', { name: 'What this project is about' }),
      'Acme Ads is a self-serve advertising tool.'
    )
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith(
        'Acme',
        expect.objectContaining({ background: 'Acme Ads is a self-serve advertising tool.' })
      )
    )
  })

  it('puts every question on screen at once, with nothing to reveal or scroll to', async () => {
    const user = userEvent.setup()
    mockedOverviews.mockResolvedValue([])
    render(<ProjectBrowser onOpen={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'New project' }))

    for (const field of [
      'Project name',
      'What this project is about',
      'Who is watching',
      'How it should sound',
      'Never say'
    ]) {
      expect(screen.getByRole('textbox', { name: field })).toBeInTheDocument()
    }
  })

  it('says which of them actually has to be answered', async () => {
    // Four questions look like a form unless it is clear that three can be left alone.
    const user = userEvent.setup()
    mockedOverviews.mockResolvedValue([])
    render(<ProjectBrowser onOpen={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'New project' }))

    expect(screen.getByText(/Only the name is needed/)).toBeInTheDocument()
  })

  it('reads a comma-separated list of rules as separate rules', async () => {
    const user = userEvent.setup()
    mockedOverviews.mockResolvedValue([])
    mockedCreate.mockResolvedValue({
      id: 'p4',
      name: 'Rules',
      createdAt: new Date().toISOString(),
      schemaVersion: 1
    })
    render(<ProjectBrowser onOpen={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'New project' }))
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Rules')
    await user.type(screen.getByRole('textbox', { name: 'Never say' }), 'pricing, roadmap')
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith(
        'Rules',
        expect.objectContaining({ neverSay: ['pricing', 'roadmap'] })
      )
    )
  })

  it('will not create a project without a name', async () => {
    const user = userEvent.setup()
    mockedOverviews.mockResolvedValue([])
    render(<ProjectBrowser onOpen={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'New project' }))

    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled()
  })

  it('asks before deleting a project, and keeps it if you decline', async () => {
    const user = userEvent.setup()
    mockedOverviews.mockResolvedValue([overview()])
    render(<ProjectBrowser onOpen={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Delete My Project' }))
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Keep' }))

    expect(mockedRemove).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Open My Project' })).toBeInTheDocument()
  })

  it('deletes a project once confirmed and drops it from the list', async () => {
    const user = userEvent.setup()
    mockedOverviews.mockResolvedValue([overview()])
    mockedRemove.mockResolvedValue(undefined)
    render(<ProjectBrowser onOpen={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Delete My Project' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mockedRemove).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open My Project' })).not.toBeInTheDocument())
  })

  it('reports a failed delete without removing the card', async () => {
    const user = userEvent.setup()
    mockedOverviews.mockResolvedValue([overview()])
    mockedRemove.mockRejectedValue(new Error('file in use'))
    render(<ProjectBrowser onOpen={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Delete My Project' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('file in use')
    expect(screen.getByRole('button', { name: 'Open My Project' })).toBeInTheDocument()
  })

  it('abandons the form on cancel', async () => {
    const user = userEvent.setup()
    mockedOverviews.mockResolvedValue([])
    render(<ProjectBrowser onOpen={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'New project' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument()
  })

  describe('leading with the project you were last in', () => {
    beforeEach(() => localStorage.clear())

    it('puts the last opened project first, apart from the rest', async () => {
      localStorage.setItem('talkie.lastProject', 'p2')
      mockedOverviews.mockResolvedValue([overview({ id: 'p1', name: 'Newest' }), overview({ id: 'p2', name: 'Worked on' })])
      render(<ProjectBrowser onOpen={vi.fn()} />)

      const lead = await screen.findByRole('region', { name: 'Continue where you left off' })
      expect(within(lead).getByRole('button', { name: 'Open Worked on' })).toBeInTheDocument()
      expect(within(screen.getByRole('region', { name: 'All projects' })).queryByRole('button', { name: 'Open Worked on' })).toBeNull()
    })

    it('leads with the newest when none has been opened here', async () => {
      mockedOverviews.mockResolvedValue([overview({ id: 'p1', name: 'Newest' }), overview({ id: 'p2', name: 'Older' })])
      render(<ProjectBrowser onOpen={vi.fn()} />)

      const lead = await screen.findByRole('region', { name: 'Continue where you left off' })
      expect(within(lead).getByRole('button', { name: 'Open Newest' })).toBeInTheDocument()
    })

    it('has no grid below it when there is only one project', async () => {
      mockedOverviews.mockResolvedValue([overview()])
      render(<ProjectBrowser onOpen={vi.fn()} />)

      await screen.findByRole('region', { name: 'Continue where you left off' })
      expect(screen.queryByRole('region', { name: 'All projects' })).toBeNull()
    })

    it('remembers a project when it is opened', async () => {
      mockedOverviews.mockResolvedValue([overview({ id: 'p1', name: 'Newest' })])
      render(<ProjectBrowser onOpen={vi.fn()} />)

      await userEvent.click(await screen.findByRole('button', { name: 'Open Newest' }))
      expect(localStorage.getItem('talkie.lastProject')).toBe('p1')
    })
  })
})
