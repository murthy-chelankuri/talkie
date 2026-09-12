import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SourcesPanel } from './SourcesPanel'
import type { ProjectMetadata } from '../api/projectClient'

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

function renderPanel(props: Partial<Parameters<typeof SourcesPanel>[0]> = {}) {
  const onToggleCollapsed = vi.fn()
  render(
    <SourcesPanel
      project={project}
      timeline={[]}
      segments={[]}
      totalFrames={0}
      progress={noProgress}
      currentVoice="Samantha"
      hasContext={false}
      onEditContext={vi.fn()}
      projectVoice={null}
      appVoice="Samantha"
      voices={[]}
      onProjectVoiceChange={vi.fn()}
      recording={false}
      exporting={false}
      exportedPath={null}
      importError={null}
      exportError={null}
      recordError={null}
      onImportImage={vi.fn()}
      onImportDeck={vi.fn()}
      onAddScene={vi.fn()}
      importingDeck={false}
      deckProgress={null}
      onRecordSession={vi.fn()}
      onExport={vi.fn()}
      onDismissExport={vi.fn()}
      collapsed={false}
      onToggleCollapsed={onToggleCollapsed}
      {...props}
    />
  )
  return { onToggleCollapsed }
}

describe('SourcesPanel', () => {
  it('offers every action when it is open', () => {
    renderPanel()

    for (const action of ['Record a session', 'Add an image', 'Import slides', 'Export video']) {
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
    }
  })

  it('keeps every action reachable when collapsed to a rail', () => {
    renderPanel({ collapsed: true })

    // The labels are gone but the buttons are not — the rail is still the way to do these things.
    for (const action of ['Record a session', 'Add an image', 'Import slides', 'Export video']) {
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
    }
  })

  it('gives up the project details and summary to make room when collapsed', () => {
    renderPanel({ collapsed: true })

    expect(screen.queryByText('Checkout demo')).not.toBeInTheDocument()
    expect(screen.queryByText(/Nothing on the timeline/)).not.toBeInTheDocument()
  })

  it('leads with the finished length when open', () => {
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

  it('asks to be collapsed', async () => {
    const user = userEvent.setup()
    const { onToggleCollapsed } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Collapse the sources panel' }))

    expect(onToggleCollapsed).toHaveBeenCalled()
  })

  it('offers a way back when collapsed', async () => {
    const user = userEvent.setup()
    const { onToggleCollapsed } = renderPanel({ collapsed: true })

    await user.click(screen.getByRole('button', { name: 'Show the sources panel' }))

    expect(onToggleCollapsed).toHaveBeenCalled()
  })

  it('still says a recording is running when there is no room for the words', () => {
    renderPanel({ collapsed: true, recording: true })

    expect(screen.getByTitle('Recording in progress')).toBeInTheDocument()
  })

  it('shows what went wrong when it has the room', () => {
    renderPanel({ exportError: 'Rendering failed.' })

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

    expect(screen.getByRole('combobox', { name: 'Voice for this demo' })).toBeInTheDocument()
  })

  it('follows the app until a voice is chosen, and says which that is', () => {
    renderPanel({ voices, projectVoice: null, appVoice: 'Samantha' })

    expect(screen.getByRole('option', { name: 'App default (Samantha)' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Voice for this demo' })).toHaveValue('')
  })

  it('shows the voice the demo has been pinned to', () => {
    renderPanel({ voices, projectVoice: 'Rishi', appVoice: 'Samantha' })

    expect(screen.getByRole('combobox', { name: 'Voice for this demo' })).toHaveValue('Rishi')
  })

  it('can pin a demo to a voice', async () => {
    const user = userEvent.setup()
    const onProjectVoiceChange = vi.fn()
    renderPanel({ voices, projectVoice: null, onProjectVoiceChange })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Voice for this demo' }), 'Rishi')

    expect(onProjectVoiceChange).toHaveBeenCalledWith('Rishi')
  })

  it('can let a pinned demo follow the app again, which is the way out', async () => {
    const user = userEvent.setup()
    const onProjectVoiceChange = vi.fn()
    renderPanel({ voices, projectVoice: 'Rishi', appVoice: 'Samantha', onProjectVoiceChange })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Voice for this demo' }), '')

    // Null, not an empty string: the project keeps no voice of its own.
    expect(onProjectVoiceChange).toHaveBeenCalledWith(null)
  })
})
