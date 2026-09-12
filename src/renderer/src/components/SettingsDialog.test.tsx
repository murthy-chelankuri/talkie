import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsDialog } from './SettingsDialog'
import { settingsClient } from '../api/projectClient'

vi.mock('../api/projectClient', () => ({
  settingsClient: {
    read: vi.fn(),
    update: vi.fn(),
    providers: vi.fn(),
    voices: vi.fn(),
    localServer: vi.fn(),
    readiness: vi.fn(),
    resetSpeech: vi.fn(),
    previewVoice: vi.fn(),
    mcpConnection: vi.fn(),
    mcpCreateToken: vi.fn(),
    mcpRevokeToken: vi.fn()
  }
}))

const defaults = {
  narration: {
    autoDraft: true,
    provider: 'template' as const,
    local: { baseUrl: '', model: '' },
    anthropic: { apiKey: '', model: 'claude-sonnet-5' }
  },
  speech: { voice: 'Samantha', pace: 170, sentencePauseMs: 420, clausePauseMs: 300 }
}

function provider(overrides = {}) {
  return { id: 'template', label: 'Built-in', sendsDataOffMachine: false, available: true, ...overrides }
}

function check(overrides = {}) {
  return { id: 'export', label: 'Video export', purpose: 'Render to MP4', ready: true, detail: 'Built in', required: true, ...overrides }
}

beforeEach(() => {
  vi.mocked(settingsClient.read).mockResolvedValue(defaults as never)
  vi.mocked(settingsClient.update).mockResolvedValue(defaults as never)
  vi.mocked(settingsClient.resetSpeech).mockResolvedValue(defaults as never)
  vi.mocked(settingsClient.providers).mockResolvedValue([provider()] as never)
  vi.mocked(settingsClient.voices).mockResolvedValue([
    { name: 'Samantha', locale: 'en_US', sample: 'Hello.', novelty: false }
  ] as never)
  vi.mocked(settingsClient.localServer).mockResolvedValue(null as never)
  vi.mocked(settingsClient.readiness).mockResolvedValue([check()] as never)
  vi.mocked(settingsClient.mcpConnection).mockResolvedValue({
    serverPath: '/tmp/talkie-mcp.mjs',
    enabled: false,
    hasToken: false,
    tokenCreatedAt: '',
    configJson: '{}',
    addCommand: 'claude mcp add talkie'
  } as never)
})

describe('SettingsDialog', () => {
  it('opens on the section most people came to change', async () => {
    render(<SettingsDialog onClose={vi.fn()} />)

    expect(await screen.findByRole('switch', { name: 'Draft narration automatically' })).toBeInTheDocument()
  })

  it('keeps the voice controls out of the way until asked for', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog onClose={vi.fn()} />)
    await screen.findByRole('switch', { name: 'Draft narration automatically' })

    expect(screen.queryByRole('combobox', { name: 'Narration voice' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Voice/ }))

    expect(await screen.findByRole('combobox', { name: 'Narration voice' })).toBeInTheDocument()
  })

  it('says nothing at all about a provider that works', async () => {
    render(<SettingsDialog onClose={vi.fn()} />)
    await screen.findByText('Built-in')

    // A tick against everything that works turns the screen into a report card.
    expect(screen.queryByText(/Ready/)).not.toBeInTheDocument()
  })

  it('explains a provider that cannot be used', async () => {
    vi.mocked(settingsClient.providers).mockResolvedValue([
      provider({ id: 'anthropic', label: 'Anthropic API', available: false, reason: 'Add an API key.' })
    ] as never)
    render(<SettingsDialog onClose={vi.fn()} />)

    expect(await screen.findByText('Add an API key.')).toBeInTheDocument()
  })

  it('leaves the system section unmarked when nothing needs doing', async () => {
    render(<SettingsDialog onClose={vi.fn()} />)
    await screen.findByText('Built-in')

    expect(screen.queryByLabelText(/needing attention/)).not.toBeInTheDocument()
  })

  it('marks the system section when something essential is missing', async () => {
    vi.mocked(settingsClient.readiness).mockResolvedValue([
      check({ id: 'recording', ready: false, required: true, fix: 'Install Chrome.' })
    ] as never)
    render(<SettingsDialog onClose={vi.fn()} />)

    expect(await screen.findByLabelText('1 needing attention')).toBeInTheDocument()
  })

  it('does not mark the section for something optional', async () => {
    vi.mocked(settingsClient.readiness).mockResolvedValue([
      check({ id: 'decks', ready: false, required: false, fix: 'Install LibreOffice.' })
    ] as never)
    render(<SettingsDialog onClose={vi.fn()} />)
    await screen.findByText('Built-in')

    expect(screen.queryByLabelText(/needing attention/)).not.toBeInTheDocument()
  })

  it('puts the voice back to its defaults when asked', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog onClose={vi.fn()} />)
    await screen.findByRole('switch', { name: 'Draft narration automatically' })

    await user.click(screen.getByRole('button', { name: /^Voice/ }))
    await user.click(await screen.findByRole('button', { name: /Reset to defaults/ }))

    await waitFor(() => expect(settingsClient.resetSpeech).toHaveBeenCalled())
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SettingsDialog onClose={onClose} />)
    await screen.findByText('Built-in')

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })
})

/**
 * A passing check has nothing to say, and five rows saying nothing is where a real problem goes
 * unnoticed. These pin the panel to showing what needs attention rather than reassurance.
 */
describe('what the System panel puts in front of you', () => {
  async function openSystem(): Promise<void> {
    const user = userEvent.setup()
    render(<SettingsDialog onClose={vi.fn()} />)
    await screen.findByRole('switch', { name: 'Draft narration automatically' })
    await user.click(screen.getByRole('button', { name: /System/ }))
  }

  it('says everything is available in one line, without listing it', async () => {
    vi.mocked(settingsClient.readiness).mockResolvedValue([
      check({ id: 'export', label: 'Video export' }),
      check({ id: 'recording', label: 'Session recording' }),
      check({ id: 'decks', label: 'PowerPoint import', required: false })
    ] as never)

    await openSystem()

    expect(await screen.findByText('Everything Talkie needs is available')).toBeInTheDocument()
    expect(screen.queryByText('Video export')).not.toBeInTheDocument()
    expect(screen.queryByText('Session recording')).not.toBeInTheDocument()
  })

  it('shows the checks when they are asked for', async () => {
    const user = userEvent.setup()
    vi.mocked(settingsClient.readiness).mockResolvedValue([
      check({ id: 'export', label: 'Video export' }),
      check({ id: 'recording', label: 'Session recording' })
    ] as never)

    await openSystem()
    await user.click(await screen.findByRole('button', { name: /Show the checks/ }))

    expect(screen.getByText('Video export')).toBeInTheDocument()
    expect(screen.getByText('Session recording')).toBeInTheDocument()
  })

  it('leads with what is wrong, and how to fix it', async () => {
    vi.mocked(settingsClient.readiness).mockResolvedValue([
      check({ id: 'export', label: 'Video export' }),
      check({
        id: 'recording',
        label: 'Session recording',
        ready: false,
        required: true,
        purpose: 'Capture a browser walkthrough',
        fix: 'Install Google Chrome.'
      })
    ] as never)

    await openSystem()

    expect(await screen.findByText('Session recording')).toBeInTheDocument()
    expect(screen.getByText('Install Google Chrome.')).toBeInTheDocument()
    // The working one stays out of the way until it is asked for.
    expect(screen.queryByText('Video export')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 other check is fine/ })).toBeInTheDocument()
  })

  it('does not claim something is missing when only an optional piece is', async () => {
    vi.mocked(settingsClient.readiness).mockResolvedValue([
      check({ id: 'decks', label: 'PowerPoint import', ready: false, required: false, fix: 'Install LibreOffice.' })
    ] as never)

    await openSystem()

    expect(await screen.findByText(/Everything required is available/)).toBeInTheDocument()
  })
})
