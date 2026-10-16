import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { HtmlScenePanel } from './HtmlScenePanel'
import { ParamsForm, blankLike, labelFor } from './ParamsForm'
import { ClipThumbnail } from '../Timeline'
import { htmlSceneClient, timelineClient, type TimelineItem } from '../../api/projectClient'

vi.mock('../../../../video/preview', () => ({ Preview: () => <div data-testid="player" /> }))
vi.mock('./CodePanel', () => ({
  CodePanel: ({ path, value, onChange }: { path: string; value: string; onChange: (text: string) => void }) => (
    <textarea aria-label={`Code of ${path}`} value={value} onChange={(e) => onChange(e.target.value)} />
  )
}))
vi.mock('../../api/projectClient', () => ({
  htmlSceneClient: {
    templates: vi.fn(),
    fromTemplate: vi.fn(),
    describe: vi.fn(),
    import: vi.fn(),
    read: vi.fn(),
    edit: vi.fn(),
    change: vi.fn()
  },
  timelineClient: { read: vi.fn() }
}))

const scene: TimelineItem = {
  id: 'h1',
  kind: 'html',
  start: 0,
  duration: 150,
  data: { src: 'http://x/s/p/sources/html/r/index.html', title: 'Revenue', style: { theme: 'dark' }, params: { quarter: 'Q3' } }
} as TimelineItem

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(htmlSceneClient.templates).mockResolvedValue([{ id: 'bar-chart', name: 'Bar chart', description: 'bars grow in turn', category: 'Data', values: { title: 'Revenue' }, thumbnail: null }])
  vi.mocked(htmlSceneClient.read).mockResolvedValue({ data: scene.data as never, files: [{ path: 'index.html', text: '<h1>Hi</h1>', bytes: 11 }, { path: 'style.css', text: 'h1{}', bytes: 4 }] })
  vi.mocked(htmlSceneClient.edit).mockResolvedValue({ item: scene, problems: [], warnings: [] })
  vi.mocked(htmlSceneClient.fromTemplate).mockResolvedValue({ item: scene, problems: [], warnings: [] })
  vi.mocked(timelineClient.read).mockResolvedValue([scene])
})

describe('starting an HTML scene', () => {
  it('offers a gallery of templates by what they are for, describing it, or an import', async () => {
    render(<HtmlScenePanel projectId="p" item={null} theme={null} onSaved={() => {}} onClose={() => {}} />)

    expect(screen.getByRole('textbox', { name: 'Describe the scene' })).toBeInTheDocument()
    const data = await screen.findByRole('region', { name: 'Data' })
    expect(within(data).getByRole('button', { name: 'Start from Bar chart' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Import a page/ })).toBeInTheDocument()
  })

  it('puts a template on the timeline and opens it to edit', async () => {
    const onSaved = vi.fn()
    render(<HtmlScenePanel projectId="p" item={null} theme={null} onSaved={onSaved} onClose={() => {}} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Start from Bar chart' }))

    expect(htmlSceneClient.fromTemplate).toHaveBeenCalledWith('p', 'bar-chart', 'Bar chart')
    expect(onSaved).toHaveBeenCalled()
    // What it says comes first, as a form.
    expect(await screen.findByRole('tab', { name: 'Content', selected: true })).toBeInTheDocument()
  })

  it('says why, when the model could not write one', async () => {
    vi.mocked(htmlSceneClient.describe).mockResolvedValue({ status: 'failed', reason: 'Choose a model in Settings, under AI.' })
    render(<HtmlScenePanel projectId="p" item={null} theme={null} onSaved={() => {}} onClose={() => {}} />)

    await userEvent.type(screen.getByRole('textbox', { name: 'Describe the scene' }), 'a chart')
    await userEvent.click(screen.getByRole('button', { name: /Make it/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a model')
  })
})

describe('editing an HTML scene', () => {
  it('keeps its code a tab away, with a tab for each of its files', async () => {
    render(<HtmlScenePanel projectId="p" item={scene} theme={null} onSaved={() => {}} onClose={() => {}} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Code' }))
    expect(await screen.findByRole('tab', { name: 'index.html' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'style.css' })).toBeInTheDocument()
  })

  it('saves a changed value without touching its files', async () => {
    render(<HtmlScenePanel projectId="p" item={scene} theme={null} onSaved={() => {}} onClose={() => {}} />)

    const quarter = screen.getByRole('textbox', { name: 'Quarter' })
    await userEvent.clear(quarter)
    await userEvent.type(quarter, 'Q4')
    await userEvent.click(screen.getByRole('button', { name: /Save scene/ }))

    expect(htmlSceneClient.edit).toHaveBeenCalledWith('p', 'h1', { files: {}, params: { quarter: 'Q4' }, style: { theme: 'dark' } })
  })

  it('saves only the file that was edited, and the look chosen', async () => {
    render(<HtmlScenePanel projectId="p" item={scene} theme={null} onSaved={() => {}} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Code' }))
    await screen.findByRole('tab', { name: 'index.html' })

    await userEvent.type(screen.getByRole('textbox', { name: 'Code of index.html' }), '!')
    await userEvent.click(screen.getByRole('tab', { name: 'Look' }))
    await userEvent.click(screen.getByRole('button', { name: 'Light' }))
    await userEvent.click(screen.getByRole('button', { name: /Save scene/ }))

    await waitFor(() =>
      expect(htmlSceneClient.edit).toHaveBeenCalledWith('p', 'h1', { files: { 'index.html': '<h1>Hi</h1>!' }, params: { quarter: 'Q3' }, style: { theme: 'light' } })
    )
  })

  it('shows what the check found', async () => {
    const flagged = { ...scene, data: { ...(scene.data as object), check: { problems: ['Uses text in #ff0000'] } } } as TimelineItem
    render(<HtmlScenePanel projectId="p" item={flagged} theme={null} onSaved={() => {}} onClose={() => {}} />)

    expect(await screen.findByText('Uses text in #ff0000')).toBeInTheDocument()
  })
})

describe('the form for a scene’s values', () => {
  function Form({ initial }: { initial: Record<string, unknown> }): JSX.Element {
    const [params, setParams] = useState(initial)
    return (
      <>
        <ParamsForm params={params} onChange={setParams} />
        <output data-testid="value">{JSON.stringify(params)}</output>
      </>
    )
  }
  const value = (): unknown => JSON.parse(screen.getByTestId('value').textContent ?? '{}')

  it('edits a list of words as rows to add, remove and reorder, not as JSON', async () => {
    render(<Form initial={{ points: ['Record', 'Narrate'] }} />)

    await userEvent.click(screen.getByRole('button', { name: 'Add point' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Point 3' }), 'Export')
    await userEvent.click(screen.getByRole('button', { name: 'Move Point 3 up' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove Point 1' }))

    expect(value()).toEqual({ points: ['Export', 'Narrate'] })
  })

  it('gives each thing in a list of things a card with its own fields, and a new one the same fields', async () => {
    render(<Form initial={{ steps: [{ label: 'Record', detail: 'As you use it' }] }} />)

    await userEvent.click(screen.getByRole('button', { name: 'Add step' }))
    const labels = screen.getAllByRole('textbox', { name: 'Label' })
    await userEvent.type(labels[1], 'Export')

    expect(value()).toEqual({ steps: [{ label: 'Record', detail: 'As you use it' }, { label: 'Export', detail: '' }] })
  })

  it('names the fields in words', () => {
    expect(labelFor('subtitle')).toBe('Subtitle')
    expect(labelFor('chartTitle')).toBe('Chart title')
    expect(labelFor('max_value')).toBe('Max value')
    expect(blankLike({ when: '2023', what: 'x', n: 3 })).toEqual({ when: '', what: '', n: 0 })
  })
})

describe('an HTML scene on the timeline', () => {
  it('shows its poster once it has one', () => {
    const { container } = render(<ClipThumbnail item={{ ...scene, data: { ...(scene.data as object), posterUrl: 'http://x/poster.png?v=1' } } as TimelineItem} />)

    expect(container.querySelector('img')?.getAttribute('src')).toBe('http://x/poster.png?v=1')
  })

  it('shows its title until then', () => {
    render(<ClipThumbnail item={scene} />)

    expect(screen.getByText('Revenue')).toBeInTheDocument()
  })
})
