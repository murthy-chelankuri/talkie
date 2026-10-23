import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AskTheAgent } from './AskTheAgent'

const instruct = vi.fn()
const stop = vi.fn()
const readiness = vi.fn()
let step: (projectId: string, step: string) => void = () => undefined

beforeEach(() => {
  instruct.mockReset()
  stop.mockReset()
  readiness.mockReset().mockResolvedValue({ ready: true, by: 'Claude CLI' })
  const onStep = (callback: typeof step): (() => void) => {
    step = callback
    return () => undefined
  }
  // @ts-expect-error — the preload bridge, as the renderer sees it.
  window.api = { agent: { instruct, stop, readiness, onStep } }
  // jsdom has no layout, so scrolling to the newest turn would throw.
  Element.prototype.scrollIntoView = vi.fn()
})

function panel(props: Record<string, unknown> = {}) {
  return render(
    <AskTheAgent
      projectId="p1"
      onClose={vi.fn()}
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

    await waitFor(() => expect(instruct).toHaveBeenLastCalledWith('p1', 'make it shorter', 'sess-1', []))
  })

  it('starts the first turn with no session to resume', async () => {
    instruct.mockResolvedValue({ status: 'done', say: 'Done.', sessionId: 's1' })
    panel()

    await say('do a thing')

    await waitFor(() => expect(instruct).toHaveBeenCalledWith('p1', 'do a thing', undefined, []))
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
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    )

    expect(screen.queryByText('Done.')).not.toBeInTheDocument()
    await say('and again')
    await waitFor(() => expect(instruct).toHaveBeenLastCalledWith('p2', 'and again', undefined, []))
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

    expect(screen.getByText(/\$0\.20/)).toBeInTheDocument()
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

  it('tells the editor when it starts and stops working, so the rail can say so while it is shut', async () => {
    let finish: (value: unknown) => void = () => undefined
    instruct.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const onWorkingChange = vi.fn()
    panel({ onWorkingChange })

    await say('rewrite it all')
    expect(onWorkingChange).toHaveBeenLastCalledWith(true)

    finish({ status: 'done', say: 'Done.' })
    await waitFor(() => expect(onWorkingChange).toHaveBeenLastCalledWith(false))
  })

  it('closes when asked', async () => {
    const onClose = vi.fn()
    panel({ onClose })

    await userEvent.click(screen.getByRole('button', { name: 'Close the agent' }))
    expect(onClose).toHaveBeenCalled()
  })

  describe('asking about particular scenes', () => {
    const timeline = [
      { id: 'c1', kind: 'scene', start: 0, duration: 150, data: { title: 'Welcome', bullets: [] } },
      { id: 'c2', kind: 'video', start: 150, duration: 300, data: { src: '/a.mp4' } },
      { id: 'c3', kind: 'scene', start: 450, duration: 150, data: { title: 'How it <b>works</b>', bullets: [] } }
    ]

    it('offers the clip selected on the timeline, and tells the agent which scene is meant', async () => {
      instruct.mockResolvedValue({ status: 'done', say: 'Shortened it.' })
      panel({ timeline, selectedItemId: 'c3' })

      await userEvent.click(screen.getByRole('button', { name: /Scene 3 · How it works/ }))
      await say('make this shorter')

      expect(instruct).toHaveBeenLastCalledWith('p1', 'make this shorter', undefined, ['c3'])
      // The turn says what it was about, so the conversation reads back right.
      expect(await screen.findByText('Shortened it.')).toBeInTheDocument()
      expect(screen.getAllByText('Scene 3 · How it works').length).toBeGreaterThan(0)
    })

    it('picks any scenes from the list, and lets one go again', async () => {
      instruct.mockResolvedValue({ status: 'done', say: 'Done.' })
      panel({ timeline })

      await userEvent.click(screen.getByRole('button', { name: 'Ask about a scene' }))
      await userEvent.click(screen.getByRole('option', { name: 'Scene 1 · Welcome' }))
      await userEvent.click(screen.getByRole('option', { name: 'Scene 2 · Recording' }))
      await userEvent.click(screen.getByRole('button', { name: 'Stop asking about Scene 1 · Welcome' }))
      await say('tighten these')

      expect(instruct).toHaveBeenLastCalledWith('p1', 'tighten these', undefined, ['c2'])
    })
  })

  it('stops a run when asked, rather than showing a stop button that does nothing', async () => {
    instruct.mockReturnValue(new Promise(() => undefined))
    panel()

    await say('rewrite everything')
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }))

    expect(stop).toHaveBeenCalledWith('p1')
  })

  it('puts an example in the box when it is pressed', async () => {
    panel()
    await userEvent.click(screen.getByRole('button', { name: 'Add an introduction and a closing statement.' }))
    expect(screen.getByLabelText(/ask talkie/i)).toHaveValue('Add an introduction and a closing statement.')
  })

  it('draws the lists and bold in an answer rather than their marks', async () => {
    instruct.mockResolvedValue({ status: 'done', say: 'Changed:\n\n- **Scene 2** narration\n- the `intro` slide' })
    panel()

    await say('go')

    const item = await screen.findByText('narration', { exact: false, selector: 'li' })
    expect(item.querySelector('strong')).toHaveTextContent('Scene 2')
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  it('says who will do the work before anything is asked', async () => {
    panel()
    expect(await screen.findByText('Claude CLI')).toBeInTheDocument()
  })

  it('says what is missing, and opens Settings where it is put right, before anything is typed', async () => {
    // Finding out from an error after writing the request was the commonest first go at this.
    readiness.mockResolvedValue({ ready: false, reason: 'Turn on "Let AI agents connect" in Settings → System.', fix: 'system' })
    const { onSettingsRequested } = await import('../lib/openSettings')
    const opened = vi.fn()
    const off = onSettingsRequested(opened)
    panel()

    expect(await screen.findByText(/Let AI agents connect/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/ask talkie/i), 'add an introduction')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /Open Settings → System/ }))
    expect(opened).toHaveBeenCalledWith('system')
    off()
  })

  it('shows each thing the agent sets about while it works', async () => {
    instruct.mockReturnValue(new Promise(() => undefined))
    panel()

    await say('add an introduction')
    act(() => {
      step('p1', 'Reading the timeline')
      step('p1', 'Adding a scene')
      step('p2', 'Something in another project')
    })

    const steps = await screen.findByRole('list', { name: 'What it has done so far' })
    expect(steps).toHaveTextContent('Reading the timeline')
    expect(steps).toHaveTextContent('Adding a scene')
    expect(steps).not.toHaveTextContent('another project')
  })

  it('starts a new conversation when asked, forgetting the old one', async () => {
    instruct.mockResolvedValue({ status: 'done', say: 'Done.', sessionId: 'sess-1' })
    panel()
    await say('do a thing')
    await screen.findByText('Done.')

    await userEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(screen.queryByText('Done.')).not.toBeInTheDocument()

    await say('something else')
    await waitFor(() => expect(instruct).toHaveBeenLastCalledWith('p1', 'something else', undefined, []))
  })

  it('puts a failed request back in the box to try again', async () => {
    instruct.mockResolvedValue({ status: 'failed', reason: 'Usage limit reached.' })
    panel()
    await say('add an introduction')
    await screen.findByText('Usage limit reached.')

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByLabelText(/ask talkie/i)).toHaveValue('add an introduction')
  })

  it('says Undo takes back the newest change, on the newest answer only', async () => {
    instruct
      .mockResolvedValueOnce({ status: 'done', say: 'One.', sessionId: 's' })
      .mockResolvedValueOnce({ status: 'done', say: 'Two.', sessionId: 's' })
    panel()
    await say('first')
    await screen.findByText('One.')
    await say('second')
    await screen.findByText('Two.')

    expect(screen.getAllByText(/takes this whole change back/)).toHaveLength(1)
  })

  it('closes the scene list on Esc without closing the panel around it', async () => {
    const timeline = [{ id: 'c1', kind: 'scene', start: 0, duration: 150, data: { title: 'Welcome', bullets: [] } }]
    panel({ timeline })
    await userEvent.click(screen.getByRole('button', { name: 'Ask about a scene' }))

    const seen: boolean[] = []
    const listen = (event: KeyboardEvent): void => {
      seen.push(event.defaultPrevented)
    }
    window.addEventListener('keydown', listen)
    await userEvent.keyboard('{Escape}')
    window.removeEventListener('keydown', listen)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    // The rail closes its panel on an Esc nothing else took.
    expect(seen).toEqual([true])
  })
})

