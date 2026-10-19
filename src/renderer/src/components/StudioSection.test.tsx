import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StudioSection } from './StudioSection'
import { settingsClient } from '../api/projectClient'

vi.mock('../api/projectClient', () => ({
  settingsClient: { studio: vi.fn(), revealStudio: vi.fn() }
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(settingsClient.revealStudio).mockResolvedValue(null)
})

describe('the Studio in Settings', () => {
  it('says where the Studio is and how to put it in git, when it is not yet', async () => {
    vi.mocked(settingsClient.studio).mockResolvedValue({ path: '/Users/me/Talkie/Studio', shownPath: '~/Talkie/Studio', inGit: false })
    render(<StudioSection />)

    expect(await screen.findByRole('status')).toHaveTextContent('Not in git yet.')
    expect(screen.getByLabelText('Commands to put the Studio in git')).toHaveTextContent('cd ~/Talkie/Studio')
    expect(screen.getByLabelText('Command to clone the Studio')).toHaveTextContent('git clone <your repository> ~/Talkie/Studio')
  })

  it('names where it is pushed to once it is in git, and stops offering to start', async () => {
    vi.mocked(settingsClient.studio).mockResolvedValue({ path: '/x', shownPath: '~/Talkie/Studio', inGit: true, remote: 'git@github.com:me/studio.git' })
    render(<StudioSection />)

    expect(await screen.findByText(/pushed to git@github.com:me\/studio.git/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Commands to put the Studio in git')).not.toBeInTheDocument()
  })

  it('opens the folder in Finder', async () => {
    vi.mocked(settingsClient.studio).mockResolvedValue({ path: '/x', shownPath: '~/Talkie/Studio', inGit: false })
    render(<StudioSection />)

    await userEvent.click(screen.getByRole('button', { name: 'Show in Finder' }))

    expect(settingsClient.revealStudio).toHaveBeenCalled()
  })
})
