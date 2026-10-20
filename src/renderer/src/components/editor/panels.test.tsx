import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectPanel } from './ProjectPanel'
import { AddPanel } from './AddPanel'
import { VoicePanel } from './VoicePanel'
import { ExportControl } from './ExportControl'
import type { ProjectMetadata } from '../../api/projectClient'

const project: ProjectMetadata = {
  id: 'p1',
  name: 'Checkout demo',
  createdAt: new Date().toISOString(),
  schemaVersion: 1
}

/** A project with nothing on it, which every test then varies from. */
const noProgress = { silent: [], unwritten: [], otherVoice: [], voiced: 0, needing: [] }

function clips(ids: string[]) {
  return ids.map((id, index) => ({
    id,
    kind: 'image',
    start: index * 90,
    duration: 90,
    data: {}
  })) as never
}

type PanelProps = Parameters<typeof ProjectPanel>[0] &
  Parameters<typeof AddPanel>[0] &
  Parameters<typeof VoicePanel>[0] &
  Parameters<typeof ExportControl>[0]

/** The Project, Add and Voice panels and Export, as the editor shows them, from one set of props. */
function renderPanel(props: Partial<PanelProps> = {}) {
  const all: PanelProps = {
    project,
    timeline: [],
    totalFrames: 0,
    clipCount: 0,
    narrated: 0,
    progress: noProgress,
    fidelityNote: null,
    currentVoice: 'Samantha',
    hasContext: false,
    onEditContext: vi.fn(),
    projectVoice: null,
    appVoice: 'Samantha',
    voices: [],
    onProjectVoiceChange: vi.fn(),
    recording: false,
    state: { status: 'idle' },
    onCancel: vi.fn(),
    importError: null,
    recordError: null,
    isEmpty: true,
    onImportImage: vi.fn(),
    onImportVideo: vi.fn(),
    onImportDeck: vi.fn(),
    onAddScene: vi.fn(),
    importingDeck: false,
    importingVideo: false,
    deckProgress: null,
    onRecordSession: vi.fn(),
    onExport: vi.fn(),
    onDismiss: vi.fn(),
    ...props
  }
  // The summary counts what is on the timeline, as the editor does when it passes these in.
  if (props.timeline && props.clipCount === undefined) all.clipCount = props.timeline.length
  if (props.progress && props.narrated === undefined) all.narrated = props.progress.voiced
  render(
    <>
      <ProjectPanel {...all} />
      <AddPanel {...all} />
      <VoicePanel {...all} />
      <ExportControl {...all} />
    </>
  )
}

describe('the editor\'s panels', () => {
  it('offers every way to add something, and Export', () => {
    renderPanel()

    for (const action of ['Record a session', 'Import a video', 'Add an image', 'Import slides', 'Export video']) {
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
    }
  })

  it('says it is reading an imported video, and holds the button while it does', () => {
    renderPanel({ importingVideo: true })

    const button = screen.getByRole('button', { name: 'Importing a video' })
    expect(button).toBeDisabled()
    expect(screen.getByText('Finding where its scenes change…')).toBeInTheDocument()
  })

  it('leads with the finished length', () => {
    renderPanel({ totalFrames: 30 * 36 })

    expect(screen.getByText('Checkout demo')).toBeInTheDocument()
    expect(screen.getByText('0:36')).toBeInTheDocument()
  })

  it('says how much of the demo still has no voice', () => {
    const timeline = clips(['a', 'b'])
    renderPanel({
      timeline,
      progress: { ...noProgress, silent: [timeline[1]], voiced: 1, needing: [timeline[1]] }
    })

    expect(screen.getByText('1 of 2 clips voiced')).toBeInTheDocument()
  })

  it('says so plainly once every clip has a voice', () => {
    renderPanel({
      timeline: clips(['a']),
      progress: { ...noProgress, voiced: 1 }
    })

    expect(screen.getByText('Every clip has a voice')).toBeInTheDocument()
  })

  it('counts a clip read by another voice as voiced, because it is', () => {
    // It has audio and it plays. Calling it unvoiced told someone with a finished project that
    // every clip was silent, and sent them off to write words they had already written.
    const timeline = clips(['a', 'b'])
    renderPanel({
      timeline,
      progress: {
        ...noProgress,
        otherVoice: timeline,
        voiced: 2,
        needing: timeline,
        previousVoice: 'Rishi'
      }
    })

    // Every clip speaks, so the summary says so — the voice they speak in is the next line's job.
    expect(screen.getByText('Every clip has a voice')).toBeInTheDocument()
  })

  it('offers the switch to the chosen voice without calling it a problem', () => {
    const timeline = clips(['a', 'b'])
    renderPanel({
      timeline,
      progress: {
        ...noProgress,
        otherVoice: timeline,
        voiced: 2,
        needing: timeline,
        previousVoice: 'Rishi'
      }
    })

    expect(screen.getByText(/read by Rishi, not Samantha/)).toBeInTheDocument()
  })

  it('only tells you to write when something is actually unwritten', () => {
    const timeline = clips(['a', 'b'])
    renderPanel({
      timeline,
      progress: { ...noProgress, silent: timeline, voiced: 0, needing: timeline }
    })

    expect(screen.getByText(/written but not spoken/)).toBeInTheDocument()
  })

  it('does not claim progress on an empty timeline', () => {
    renderPanel()

    expect(screen.getByText('Nothing on the timeline yet')).toBeInTheDocument()
  })

  it('says a recording is running', () => {
    renderPanel({ recording: true })

    expect(screen.getByTitle('Recording in progress')).toBeInTheDocument()
  })

  it('shows what went wrong when it has the room', () => {
    renderPanel({ state: { status: 'failed', message: 'Rendering failed.' } })

    expect(screen.getByRole('alert')).toHaveTextContent('Rendering failed.')
  })
})

/**
 * The voice a demo speaks in has to be changeable at any time, in both directions. It was once
 * reachable only from a card that appeared on a mismatch, so a voice could be chosen once and
 * never changed again.
 */
describe('the voice this demo speaks in', () => {
  const voices = [
    { name: 'Samantha', locale: 'en_US', sample: 'Hello.', novelty: false },
    { name: 'Rishi', locale: 'en_IN', sample: 'Hello.', novelty: false }
  ] as never

  it('is offered whether or not anything is wrong', () => {
    renderPanel({ voices })

    expect(screen.getByRole('combobox', { name: 'Voice for this project' })).toBeInTheDocument()
  })

  it('follows the app until a voice is chosen, and says which that is', () => {
    renderPanel({ voices, projectVoice: null, appVoice: 'Samantha' })

    expect(screen.getByRole('option', { name: 'App default (Samantha)' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Voice for this project' })).toHaveValue('')
  })

  it('shows the voice the demo has been pinned to', () => {
    renderPanel({ voices, projectVoice: 'Rishi', appVoice: 'Samantha' })

    expect(screen.getByRole('combobox', { name: 'Voice for this project' })).toHaveValue('Rishi')
  })

  it('can pin a demo to a voice', async () => {
    const user = userEvent.setup()
    const onProjectVoiceChange = vi.fn()
    renderPanel({ voices, projectVoice: null, onProjectVoiceChange })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Voice for this project' }), 'Rishi')

    expect(onProjectVoiceChange).toHaveBeenCalledWith('Rishi')
  })

  it('can let a pinned demo follow the app again, which is the way out', async () => {
    const user = userEvent.setup()
    const onProjectVoiceChange = vi.fn()
    renderPanel({ voices, projectVoice: 'Rishi', appVoice: 'Samantha', onProjectVoiceChange })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Voice for this project' }), '')

    // Null, not an empty string: the project keeps no voice of its own.
    expect(onProjectVoiceChange).toHaveBeenCalledWith(null)
  })
})

describe('why a project sounds the way it does', () => {
  const note = {
    summary: 'Samantha is a compact voice — thinner than it needs to be.',
    detail: 'Recorded at 22.1 kHz. macOS has better versions of the same voices, free to download under Manage Voices.'
  }

  it('says nothing when the voice is not what is limiting the recording', () => {
    renderPanel({ fidelityNote: null })

    expect(screen.queryByText(/compact voice/)).not.toBeInTheDocument()
  })

  it('names the voice without making the errand permanent furniture', () => {
    renderPanel({ fidelityNote: note })

    expect(screen.getByText(/Samantha is a compact voice/)).toBeInTheDocument()
    // The remedy is written, but folded away until it is asked for.
    expect(screen.getByText(/free to download/).closest('details')).not.toHaveAttribute('open')
  })

  it('opens to the fix when asked', async () => {
    const user = userEvent.setup()
    renderPanel({ fidelityNote: note })

    await user.click(screen.getByText(/Samantha is a compact voice/))

    expect(screen.getByText(/free to download/).closest('details')).toHaveAttribute('open')
  })
})

describe('Export, in the top bar', () => {
  const running = (fraction: number, stage: 'preparing' | 'rendering' | 'encoding' | 'finishing' = 'rendering') =>
    ({
      status: 'running',
      progress: { stage, fraction, renderedFrames: 312, totalFrames: 1800 },
      startedAt: Date.now()
    }) as const

  it('says how far it has got while it exports, rather than only greying out', () => {
    renderPanel({ state: running(0.42) })

    expect(screen.getByRole('button', { name: 'Exporting video, 42%' })).toBeEnabled()
    expect(screen.getByRole('progressbar', { name: 'Export' })).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByText('Drawing frame 312 of 1,800')).toBeInTheDocument()
  })

  it('names each step, so a slow one does not look stuck', () => {
    renderPanel({ state: running(0.96, 'finishing') })

    expect(screen.getByText('Levelling the sound and writing captions')).toBeInTheDocument()
  })

  it('can be cancelled part way', async () => {
    const onCancel = vi.fn()
    renderPanel({ state: running(0.3), onCancel })

    await userEvent.click(screen.getByRole('button', { name: 'Cancel export' }))

    expect(onCancel).toHaveBeenCalled()
  })

  it('cannot be started twice: pressing it again only hides or shows the progress', async () => {
    const onExport = vi.fn()
    renderPanel({ state: running(0.5), onExport })

    await userEvent.click(screen.getByRole('button', { name: 'Exporting video, 50%' }))

    expect(onExport).not.toHaveBeenCalled()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says it failed and why, and offers to try again', async () => {
    const onExport = vi.fn()
    renderPanel({ state: { status: 'failed', message: 'The browser closed.' }, onExport })

    expect(screen.getByRole('alert')).toHaveTextContent('Export failed')
    expect(screen.getByRole('alert')).toHaveTextContent('The browser closed.')
    await userEvent.click(screen.getByRole('button', { name: 'Export again' }))
    expect(onExport).toHaveBeenCalled()
  })

  it('says when it was cancelled', () => {
    renderPanel({ state: { status: 'cancelled' } })

    expect(screen.getByText('Export cancelled')).toBeInTheDocument()
  })
})
