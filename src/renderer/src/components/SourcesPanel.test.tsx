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

function renderPanel(props: Partial<Parameters<typeof SourcesPanel>[0]> = {}) {
  const onToggleCollapsed = vi.fn()
  render(
    <SourcesPanel
      project={project}
      timeline={[]}
      segments={[]}
      totalFrames={0}
      recording={false}
      exporting={false}
      exportedPath={null}
      importError={null}
      exportError={null}
      recordError={null}
      onImportImage={vi.fn()}
      onImportDeck={vi.fn()}
      importingDeck={false}
      deckProgress={null}
      onRecordSession={vi.fn()}
      onExport={vi.fn()}
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

  it('gives up the project details and stats to make room when collapsed', () => {
    renderPanel({ collapsed: true })

    expect(screen.queryByText('Checkout demo')).not.toBeInTheDocument()
    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
  })

  it('shows them when open', () => {
    renderPanel()

    expect(screen.getByText('Checkout demo')).toBeInTheDocument()
    expect(screen.getByText('Duration')).toBeInTheDocument()
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
