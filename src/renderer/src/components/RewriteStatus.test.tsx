import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { RewriteStatus } from './RewriteStatus'
import type { RewriteEvent } from '../../../main/menu/editContextMenu'

let emit: (event: RewriteEvent) => void = () => undefined
const insertText = vi.fn(() => true)

beforeEach(() => {
  // @ts-expect-error — the preload bridge, as the renderer sees it.
  window.api = { menu: { onRewrite: (callback: (event: RewriteEvent) => void) => ((emit = callback), () => undefined) } }
  insertText.mockClear()
  document.execCommand = insertText as unknown as typeof document.execCommand
})
afterEach(() => document.body.replaceChildren())

function field(value: string): HTMLTextAreaElement {
  const box = document.createElement('textarea')
  box.value = value
  document.body.appendChild(box)
  return box
}

describe('a rewrite from the right-click menu', () => {
  it('says it is working, and holds the words still while it does', () => {
    render(<RewriteStatus />)
    const box = field('Here is the board, with every task on it.')
    box.focus()
    box.setSelectionRange(0, 18)

    act(() => emit({ state: 'started', doing: 'Rephrasing' }))

    expect(screen.getByRole('status')).toHaveTextContent(/Rephrasing the selected words… 0s/)
    expect(box.readOnly).toBe(true)
    expect(box).toHaveAttribute('aria-busy', 'true')
  })

  it('puts the answer where the selection was, even after a click somewhere else', () => {
    render(<RewriteStatus />)
    const box = field('Here is the board, with every task on it.')
    const elsewhere = field('another scene')
    box.focus()
    box.setSelectionRange(0, 18)
    act(() => emit({ state: 'started', doing: 'Rephrasing' }))

    elsewhere.focus()
    act(() => emit({ state: 'done', text: 'This is the board' }))

    expect(document.activeElement).toBe(box)
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, 18])
    expect(insertText).toHaveBeenCalledWith('insertText', false, 'This is the board')
    expect(box.readOnly).toBe(false)
    expect(screen.getByRole('status')).toHaveTextContent(/Done/)
  })

  it('says why when it fails, and lets the words go', () => {
    render(<RewriteStatus />)
    const box = field('words')
    box.focus()
    act(() => emit({ state: 'started', doing: 'Proofreading' }))
    act(() => emit({ state: 'failed', message: 'No narration provider is set up.' }))

    expect(screen.getByRole('alert')).toHaveTextContent('No narration provider is set up.')
    expect(box.readOnly).toBe(false)
    expect(insertText).not.toHaveBeenCalled()
  })
})
