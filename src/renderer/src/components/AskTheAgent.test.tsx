import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AskTheAgent } from './AskTheAgent'

const instruct = vi.fn()

beforeEach(() => {
  instruct.mockReset()
  // @ts-expect-error — the preload bridge, as the renderer sees it.
  window.api = { agent: { instruct } }
  // jsdom has no layout, so scrolling to the newest turn would throw.
  Element.prototype.scrollIntoView = vi.fn()
})

function panel(props: Record<string, unknown> = {}) {
  return render(
    <AskTheAgent
      projectId="p1"
      collapsed={false}
      onToggleCollapsed={vi.fn()}
      onChanged={vi.fn()}
      {...props}
    />
  )
}

async function say(what: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(/ask talkie/i), what)
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('asking Talkie to change the project', () => {
  it('keeps both sides of the conversation on screen', async () => {
    instruct.mockResolvedValue({ status: 'done', say: 'Added an introduction.', sessionId: 's1' })
    panel()

    await say('add an introduction')

    expect(await screen.findByText('Added an introduction.')).toBeInTheDocument()
    // What was asked stays visible, or there is no conversation to read.
    expect(screen.getByText('add an introduction')).toBeInTheDocument()
  })

  it('carries the conversation on, so a follow-up knows what it refers to', async () => {
    // A chat that forgot everything between messages would be a worse lie than one box.
    instruct
      .mockResolvedValueOnce({ status: 'done', say: 'Added it.', sessionId: 'sess-1' })
      .mockResolvedValueOnce({ status: 'done', say: 'Shortened it.', sessionId: 'sess-1' })
    panel()

    await say('add an introduction')
    await screen.findByText('Added it.')
    await say('make it shorter')

    await waitFor(() => expect(instruct).toHaveBeenLastCalledWith('p1', 'make it shorter', 'sess-1'))
  })

  it('starts the first turn with no session to resume', async () => {
    instruct.mockResolvedValue({ status: 'done', say: 'Done.', sessionId: 's1' })
    panel()

    await say('do a thing')

    await waitFor(() => expect(instruct).toHaveBeenCalledWith('p1', 'do a thing', undefined))
  })

  it('starts again when a different project is opened', async () => {
    // The conversation is about a project; carrying it to another one would have the agent
    // answering about scenes that are not there.
    instruct.mockResolvedValue({ status: 'done', say: 'Done.', sessionId: 'sess-1' })
    const { rerender } = panel()

    await say('do a thing')
    await screen.findByText('Done.')

    rerender(
      <AskTheAgent
        projectId="p2"
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        onChanged={vi.fn()}
      />
    )

    expect(screen.queryByText('Done.')).not.toBeInTheDocument()
    await say('and again')
    await waitFor(() => expect(instruct).toHaveBeenLastCalledWith('p2', 'and again', undefined))
  })

  it('shows a failure as a turn rather than losing the thread', async () => {
    instruct.mockResolvedValue({ status: 'failed', reason: 'Usage limit reached.' })
    const onChanged = vi.fn()
    panel({ onChanged })

    await say('do a lot')

    expect(await screen.findByText('Usage limit reached.')).toBeInTheDocument()
    // It may have changed things before it stopped.
    expect(onChanged).toHaveBeenCalled()
  })

  it('adds up what the conversation has cost, since a run is not free', async () => {
    instruct
      .mockResolvedValueOnce({ status: 'done', say: 'One.', sessionId: 's', costUsd: 0.12 })
      .mockResolvedValueOnce({ status: 'done', say: 'Two.', sessionId: 's', costUsd: 0.08 })
    panel()

    await say('first')
    await screen.findByText('One.')
    await say('second')
    await screen.findByText('Two.')

    expect(screen.getByText('$0.20')).toBeInTheDocument()
  })

  it('says what it can be asked for before it has been asked anything', async () => {
    panel()

    expect(screen.getByText(/whole project/i)).toBeInTheDocument()
    expect(screen.getByText(/Add an introduction and a closing statement\./)).toBeInTheDocument()
  })

  it('will not send an empty instruction', async () => {
    panel()

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/ask talkie/i), '   ')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('says it is working, and that the files are being written', async () => {
    let finish: (value: unknown) => void = () => undefined
    instruct.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    panel()

    await say('rewrite it all')

    expect(await screen.findByText(/writing the same files/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/ask talkie/i)).toBeDisabled()

    finish({ status: 'done', say: 'Done.' })
    await waitFor(() => expect(screen.getByLabelText(/ask talkie/i)).not.toBeDisabled())
  })

  it('folds away to a strip, still showing that it is working', async () => {
    let finish: (value: unknown) => void = () => undefined
    instruct.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { rerender } = panel()

    await say('rewrite it all')
    rerender(
      <AskTheAgent projectId="p1" collapsed onToggleCollapsed={vi.fn()} onChanged={vi.fn()} />
    )

    expect(screen.queryByLabelText(/ask talkie to change/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Working')).toBeInTheDocument()
    expect(screen.getByLabelText('Show the agent')).toBeInTheDocument()

    finish({ status: 'done', say: 'Done.' })
  })
})
