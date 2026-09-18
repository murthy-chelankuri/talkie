import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AskTheAgent } from './AskTheAgent'

const instruct = vi.fn()

beforeEach(() => {
  instruct.mockReset()
  // @ts-expect-error — the preload bridge, as the renderer sees it.
  window.api = { agent: { instruct } }
})

describe('asking Talkie to change the project', () => {
  it('sends the instruction and says what was changed', async () => {
    instruct.mockResolvedValue({ status: 'done', say: 'Added an introduction before scene 1.' })
    const onChanged = vi.fn()
    render(<AskTheAgent projectId="p1" collapsed={false} onToggleCollapsed={vi.fn()} onChanged={onChanged} />)

    await userEvent.type(screen.getByLabelText(/ask talkie/i), 'add an introduction')
    await userEvent.click(screen.getByRole('button', { name: /ask/i }))

    await waitFor(() => expect(instruct).toHaveBeenCalledWith('p1', 'add an introduction'))
    expect(await screen.findByText('Added an introduction before scene 1.')).toBeInTheDocument()
  })

  it('reloads the editor afterwards, because the files moved underneath it', async () => {
    // The agent writes through a process of its own, so nothing the editor is holding can be
    // trusted once it has run.
    instruct.mockResolvedValue({ status: 'done', say: 'Done.' })
    const onChanged = vi.fn()
    render(<AskTheAgent projectId="p1" collapsed={false} onToggleCollapsed={vi.fn()} onChanged={onChanged} />)

    await userEvent.type(screen.getByLabelText(/ask talkie/i), 'tidy it up')
    await userEvent.click(screen.getByRole('button', { name: /ask/i }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('reloads even when the run failed, since it may have changed things first', async () => {
    instruct.mockResolvedValue({ status: 'failed', reason: 'Usage limit reached.' })
    const onChanged = vi.fn()
    render(<AskTheAgent projectId="p1" collapsed={false} onToggleCollapsed={vi.fn()} onChanged={onChanged} />)

    await userEvent.type(screen.getByLabelText(/ask talkie/i), 'do a lot')
    await userEvent.click(screen.getByRole('button', { name: /ask/i }))

    expect(await screen.findByText('Usage limit reached.')).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalled()
  })

  it('keeps the instruction when it failed, so it can be tried again', async () => {
    instruct.mockResolvedValue({ status: 'failed', reason: 'Not signed in.' })
    render(<AskTheAgent projectId="p1" collapsed={false} onToggleCollapsed={vi.fn()} onChanged={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/ask talkie/i), 'add a closing statement')
    await userEvent.click(screen.getByRole('button', { name: /ask/i }))

    await screen.findByText('Not signed in.')
    expect(screen.getByLabelText(/ask talkie/i)).toHaveValue('add a closing statement')
  })

  it('will not send an empty instruction', async () => {
    render(<AskTheAgent projectId="p1" collapsed={false} onToggleCollapsed={vi.fn()} onChanged={vi.fn()} />)

    expect(screen.getByRole('button', { name: /ask/i })).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/ask talkie/i), '   ')
    expect(screen.getByRole('button', { name: /ask/i })).toBeDisabled()
  })

  it('says it is working, and that the files are being written', async () => {
    // The one rule while it runs: the agent is writing the same files the editor is showing.
    let finish: (value: unknown) => void = () => undefined
    instruct.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(<AskTheAgent projectId="p1" collapsed={false} onToggleCollapsed={vi.fn()} onChanged={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/ask talkie/i), 'rewrite it all')
    await userEvent.click(screen.getByRole('button', { name: /ask/i }))

    expect(await screen.findByText(/writing the same files/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/ask talkie/i)).toBeDisabled()

    finish({ status: 'done', say: 'Done.' })
    await waitFor(() => expect(screen.getByLabelText(/ask talkie/i)).not.toBeDisabled())
  })

  it('folds away to a strip, still showing that it is working', async () => {
    // The stage is mostly the video, so the rail has to be able to get out of the way — but a
    // run that is still going is the one thing worth saying at that width.
    let finish: (value: unknown) => void = () => undefined
    instruct.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { rerender } = render(
      <AskTheAgent projectId="p1" collapsed={false} onToggleCollapsed={vi.fn()} onChanged={vi.fn()} />
    )

    await userEvent.type(screen.getByLabelText(/ask talkie/i), 'rewrite it all')
    await userEvent.click(screen.getByRole('button', { name: /ask/i }))
    rerender(
      <AskTheAgent projectId="p1" collapsed onToggleCollapsed={vi.fn()} onChanged={vi.fn()} />
    )

    expect(screen.queryByLabelText(/ask talkie to change/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Working')).toBeInTheDocument()
    expect(screen.getByLabelText('Show the agent')).toBeInTheDocument()

    finish({ status: 'done', say: 'Done.' })
  })
})
