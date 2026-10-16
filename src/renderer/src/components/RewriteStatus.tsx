import { useEffect, useRef, useState } from 'react'
import { Check, TriangleAlert, X } from 'lucide-react'
import type { RewriteEvent } from '../../../main/menu/editContextMenu'
import { Working } from './ui/Working'

/** Where the words being rewritten were, so the answer goes back there and nowhere else. */
type Held = {
  element: HTMLElement
  /** A text field's selection. */
  start?: number
  end?: number
  /** A rich text field's. */
  range?: Range
  wasReadOnly?: boolean
  wasEditable?: string | null
}

type Shown = { state: 'working'; doing: string } | { state: 'done' } | { state: 'failed'; message: string } | null

/**
 * A rewrite from the right-click menu — Rephrase, Proofread, Make concise, Fit the clip — said
 * while it runs, and its answer put back where the words were.
 *
 * It takes a model several seconds, and nothing on screen said one was going on: the menu shut
 * and the words sat there. Now the field is held — dimmed, locked, its selection remembered — and
 * a note at the foot of the window says what is happening and for how long. The answer goes into
 * the selection as it was, as one edit the field's own undo takes back; it was once typed into
 * whatever had focus when the answer came, which after a click elsewhere was somewhere else.
 */
export function RewriteStatus(): JSX.Element | null {
  const [shown, setShown] = useState<Shown>(null)
  const held = useRef<Held | null>(null)

  useEffect(() => {
    const onRewrite = window.api?.menu?.onRewrite
    if (!onRewrite) return
    return onRewrite((event: RewriteEvent) => {
      if (event.state === 'started') {
        held.current = hold()
        setShown({ state: 'working', doing: event.doing })
      } else if (event.state === 'done') {
        const placed = putBack(held.current, event.text)
        held.current = null
        if (placed) setShown({ state: 'done' })
        else {
          void navigator.clipboard?.writeText(event.text).catch(() => undefined)
          setShown({ state: 'failed', message: 'The box the words came from has gone, so the rewrite is on the clipboard instead.' })
        }
      } else {
        release(held.current)
        held.current = null
        setShown({ state: 'failed', message: event.message })
      }
    })
  }, [])

  // Done says so briefly; a failure stays until it is read.
  useEffect(() => {
    if (shown?.state !== 'done') return
    const timer = setTimeout(() => setShown(null), 3000)
    return () => clearTimeout(timer)
  }, [shown])

  if (!shown) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-lg items-center gap-2.5 rounded-full bg-raised px-4 py-2 text-[12px] text-text shadow-2xl ring-1 ring-border">
        {shown.state === 'working' && <Working what={`${shown.doing} the selected words`} slowNote="a model can take a while" className="text-[12px]" />}
        {shown.state === 'done' && (
          <span role="status" className="flex items-center gap-1.5">
            <Check size={13} className="text-accent" aria-hidden="true" />
            Done. Undo (⌘Z) in the box puts the old words back.
          </span>
        )}
        {shown.state === 'failed' && (
          <>
            <span role="alert" className="flex items-center gap-1.5 text-danger">
              <TriangleAlert size={13} aria-hidden="true" />
              {shown.message}
            </span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setShown(null)}
              className="flex h-5 w-5 items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-muted hover:text-text"
            >
              <X size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function hold(): Held | null {
  const element = document.activeElement as HTMLElement | null
  if (!element || element === document.body) return null
  const held: Held = { element }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    held.start = element.selectionStart ?? 0
    held.end = element.selectionEnd ?? held.start
    held.wasReadOnly = element.readOnly
    element.readOnly = true
  } else {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) held.range = selection.getRangeAt(0).cloneRange()
    held.wasEditable = element.getAttribute('contenteditable')
    element.setAttribute('contenteditable', 'false')
  }
  element.setAttribute('aria-busy', 'true')
  element.style.opacity = '0.55'
  return held
}

function release(held: Held | null): void {
  if (!held) return
  const { element } = held
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) element.readOnly = held.wasReadOnly ?? false
  else if (held.wasEditable === null) element.removeAttribute('contenteditable')
  else if (held.wasEditable !== undefined) element.setAttribute('contenteditable', held.wasEditable)
  element.removeAttribute('aria-busy')
  element.style.opacity = ''
}

/** The answer in place of the selection the menu was used on. False if there is nowhere to put it. */
function putBack(held: Held | null, text: string): boolean {
  if (!held || !held.element.isConnected) {
    release(held)
    return false
  }
  release(held)
  const { element } = held
  element.focus()
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    element.setSelectionRange(held.start ?? 0, held.end ?? held.start ?? 0)
  } else if (held.range) {
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(held.range)
  }
  // An edit the field's own undo holds, and one React hears as typing.
  return document.execCommand('insertText', false, text)
}
