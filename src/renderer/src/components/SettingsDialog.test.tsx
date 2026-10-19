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
    speechEngines: vi.fn(),
    localServer: vi.fn(),
    copilotModels: vi.fn(),
    readiness: vi.fn(),
    resetSpeech: vi.fn(),
    previewVoice: vi.fn(),
    mcpConnection: vi.fn(),
    mcpCreateToken: vi.fn(),
    mcpRevokeToken: vi.fn(),
    kokoroDownload: vi.fn(),
    kokoroStatus: vi.fn(),
    kokoroManual: vi.fn(),
    kokoroImport: vi.fn(),
    kokoroCheck: vi.fn(),
    kokoroShowFolder: vi.fn(),
    studio: vi.fn(() => Promise.resolve({ path: '/x', shownPath: '~/Talkie/Studio', inGit: false })),
    revealStudio: vi.fn()
  }
}))

const defaults = {
  narration: {
    autoDraft: true,
    provider: 'template' as const,
    local: { baseUrl: '', model: '' },
    anthropic: { apiKey: '', model: 'claude-sonnet-5' },
    claudeCli: { model: '' },
    copilotCli: { model: '' }
  },
  export: { burnCaptions: false },
  speech: {
    engine: 'system' as const,
    voice: 'Samantha',
    pace: 170,
    sentencePauseMs: 420,
    clausePauseMs: 300
  }
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
  vi.mocked(settingsClient.speechEngines).mockResolvedValue([
    { id: 'system', label: 'macOS voices', description: 'Nothing to install or start.', available: true },
    { id: 'kokoro', label: 'Kokoro', description: 'Sounds close to a person.', available: false, reason: 'Download the voice first — about 163 MB, once.' }
  ] as never)
  vi.mocked(settingsClient.voices).mockResolvedValue([
    { name: 'Samantha', locale: 'en_US', sample: 'Hello.', novelty: false }
  ] as never)
  vi.mocked(settingsClient.localServer).mockResolvedValue(null as never)
  vi.mocked(settingsClient.copilotModels).mockResolvedValue([] as never)
  vi.mocked(settingsClient.readiness).mockResolvedValue([check()] as never)
  vi.mocked(settingsClient.kokoroStatus).mockResolvedValue({ downloaded: false, downloading: false, loaded: 0, total: 0 } as never)
  vi.mocked(settingsClient.kokoroDownload).mockResolvedValue(undefined as never)
  vi.mocked(settingsClient.kokoroManual).mockResolvedValue({
    folder: '/Users/someone/Talkie/Models/onnx-community/Kokoro-82M-v1.0-ONNX/1939ad2',
    displayFolder: '~/Talkie/Models/onnx-community/Kokoro-82M-v1.0-ONNX/1939ad2',
    files: ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_fp16.onnx'].map((path, index) => ({
      path,
      url: `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2/${path}`,
      bytes: [44, 3497, 113, 163_234_740][index],
      sha256: 'a'.repeat(64)
    })),
    instructions: 'Talkie: downloading the Kokoro voice by hand'
  } as never)
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
  it('offers only the two voices that run on this Mac, and says what each is', async () => {
    render(<SettingsDialog onClose={vi.fn()} />)

    expect(await screen.findByRole('radio', { name: /macOS voices/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Kokoro/ })).toBeInTheDocument()
    expect(screen.getAllByRole('radio', { name: /voices|Kokoro/ }).filter((r) => r.getAttribute('name') === 'speech-engine')).toHaveLength(2)
    expect(screen.getByText('Sounds close to a person.')).toBeInTheDocument()
  })

  it('offers the Kokoro download where Kokoro is chosen, saying how big it is', async () => {
    render(<SettingsDialog onClose={vi.fn()} />)

    expect(await screen.findByText('Download the voice first — about 163 MB, once.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download voice/ })).toBeInTheDocument()
  })

  it('starts the download when asked, and shows how far it has got', async () => {
    render(<SettingsDialog onClose={vi.fn()} />)
    const download = await screen.findByRole('button', { name: /Download voice/ })
    vi.mocked(settingsClient.kokoroStatus).mockResolvedValue({
      downloaded: false,
      downloading: true,
      loaded: 54_000_000,
      total: 163_000_000
    } as never)
    vi.mocked(settingsClient.kokoroDownload).mockReturnValue(new Promise(() => {}) as never)

    await userEvent.click(download)

    expect(settingsClient.kokoroDownload).toHaveBeenCalled()
    expect(await screen.findByRole('progressbar', { name: 'Downloading the Kokoro voice' })).toBeInTheDocument()
    expect(await screen.findByText('Downloading the voice — 54 of 163 MB')).toBeInTheDocument()
  })

  it('says why a download failed, and offers to try again', async () => {
    vi.mocked(settingsClient.kokoroStatus).mockResolvedValue({
      downloaded: false,
      downloading: false,
      loaded: 0,
      total: 0,
      error: 'Could not reach Hugging Face to download the voice. Check the connection and try again.'
    } as never)
    render(<SettingsDialog onClose={vi.fn()} />)

    expect(await screen.findByText(/Could not reach Hugging Face/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })

  it('opens the way to download it by hand once the download has failed, linking every file', async () => {
    vi.mocked(settingsClient.kokoroStatus).mockResolvedValue({
      downloaded: false,
      downloading: false,
      loaded: 0,
      total: 0,
      error: 'A proxy or firewall stopped the download from Hugging Face. Download the files yourself and add them below.'
    } as never)
    render(<SettingsDialog onClose={vi.fn()} />)

    const weights = await screen.findByRole('link', { name: 'onnx/model_fp16.onnx' })
    expect(weights).toBeVisible()
    expect(weights).toHaveAttribute('href', 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2/onnx/model_fp16.onnx')
    expect(screen.getAllByRole('link', { name: /json|onnx/ })).toHaveLength(4)
    expect(screen.getByText('~/Talkie/Models/onnx-community/Kokoro-82M-v1.0-ONNX/1939ad2')).toBeInTheDocument()
  })

  it('takes the downloaded files, and makes Kokoro available once they are all there', async () => {
    vi.mocked(settingsClient.kokoroImport).mockResolvedValue({
      ready: true,
      missing: [],
      wrong: [],
      placed: ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_fp16.onnx'],
      unrecognised: []
    } as never)
    render(<SettingsDialog onClose={vi.fn()} />)
    await userEvent.click(await screen.findByText('Download it yourself instead'))
    vi.mocked(settingsClient.speechEngines).mockClear()

    await userEvent.click(screen.getByRole('button', { name: /Choose downloaded files/ }))

    expect(await screen.findByText('The voice is in place.')).toBeInTheDocument()
    await waitFor(() => expect(settingsClient.speechEngines).toHaveBeenCalled())
  })

  it('says what the chosen files left out, and which were not the voice at all', async () => {
    vi.mocked(settingsClient.kokoroImport).mockResolvedValue({
      ready: false,
      missing: ['onnx/model_fp16.onnx'],
      wrong: [],
      placed: ['config.json'],
      unrecognised: ['blocked.html']
    } as never)
    render(<SettingsDialog onClose={vi.fn()} />)
    await userEvent.click(await screen.findByText('Download it yourself instead'))

    await userEvent.click(screen.getByRole('button', { name: /Choose downloaded files/ }))

    expect(
      await screen.findByText('Added config.json. Not one of the voice’s files: blocked.html. Still needed: onnx/model_fp16.onnx.')
    ).toBeInTheDocument()
  })

  it('lists the voices of the engine just chosen, not the one before it', async () => {
    render(<SettingsDialog onClose={vi.fn()} />)
    await screen.findByRole('combobox', { name: 'Narration voice' })
    vi.mocked(settingsClient.voices).mockClear()

    await userEvent.click(screen.getByRole('radio', { name: /Kokoro/ }))

    await vi.waitFor(() => expect(settingsClient.voices).toHaveBeenCalled())
  })

  it('opens on the section most people came to change', async () => {
    render(<SettingsDialog onClose={vi.fn()} />)

    expect(await screen.findByRole('switch', { name: 'Draft narration automatically' })).toBeInTheDocument()
  })

  it('shows who speaks it on the same page as who writes it', async () => {
    // Writing and speaking are different jobs, but they are the two halves of one thing — a
    // separate sidebar entry for each read as though they were unrelated settings.
    render(<SettingsDialog onClose={vi.fn()} />)
    await screen.findByRole('switch', { name: 'Draft narration automatically' })

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

/**
 * What a provider needs to be told belongs to that provider.
 *
 * These fields used to sit at the foot of the whole list, a scroll below the option they
 * configure and with nothing to say which one they were for.
 */
describe('where a provider’s own settings live', () => {
  const localProvider = provider({ id: 'local', label: 'Local model', sendsDataOffMachine: false })

  function card(name: string): HTMLElement {
    const option = screen.getByRole('radio', { name: new RegExp(name) })
    return option.closest('div[class*="rounded-lg"]') as HTMLElement
  }

  it('keeps them inside the card of the provider they belong to', async () => {
    vi.mocked(settingsClient.read).mockResolvedValue({
      ...defaults,
      narration: { ...defaults.narration, provider: 'local' }
    } as never)
    vi.mocked(settingsClient.providers).mockResolvedValue([provider(), localProvider] as never)
    vi.mocked(settingsClient.localServer).mockResolvedValue({
      label: 'LM Studio',
      baseUrl: 'http://127.0.0.1:1234/v1',
      models: ['a-model']
    } as never)

    render(<SettingsDialog onClose={vi.fn()} />)
    const address = await screen.findByRole('textbox', { name: 'Local server address' })

    expect(card('Local model')).toContainElement(address)
  })

  it('shows them only for the provider that is chosen', async () => {
    vi.mocked(settingsClient.read).mockResolvedValue({
      ...defaults,
      narration: { ...defaults.narration, provider: 'template' }
    } as never)
    vi.mocked(settingsClient.providers).mockResolvedValue([provider(), localProvider] as never)

    render(<SettingsDialog onClose={vi.fn()} />)
    await screen.findByText('Local model')

    expect(screen.queryByRole('textbox', { name: 'Local server address' })).not.toBeInTheDocument()
  })

  it('does the same for a provider that needs a key', async () => {
    vi.mocked(settingsClient.read).mockResolvedValue({
      ...defaults,
      narration: { ...defaults.narration, provider: 'anthropic' }
    } as never)
    vi.mocked(settingsClient.providers).mockResolvedValue([
      provider(),
      provider({ id: 'anthropic', label: 'Anthropic API' })
    ] as never)

    render(<SettingsDialog onClose={vi.fn()} />)
    const key = await screen.findByLabelText('Anthropic API key')

    expect(card('Anthropic API')).toContainElement(key)
  })
})
