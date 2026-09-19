import { useEffect, useRef, useState } from 'react'
import { ArrowUp, PanelRightClose, PanelRightOpen, Sparkles, Square } from 'lucide-react'
import { agentClient } from '../api/projectClient'
import { cn } from '../lib/cn'
import { IconButton } from './ui/IconButton'

/**
 * Asking Talkie to change the project, in conversation.
 *
 * The app could already do one thing at a time on its own — rewrite this line, write that
 * slide. What it could not do was anything spanning a project: "add an introduction and a
 * closing statement", "the middle three all say the same thing".
 *
 * It reads as a conversation because it is one: each turn resumes the last, so "make that
 * shorter" knows what "that" was. A chat that forgot everything between messages would be a
 * worse lie than a single instruction box, which is what this replaced.
 *
 * It lives beside the video rather than inside the script, because what it changes is the
 * project and not only the words.
 */

export interface Turn {
  from: 'you' | 'talkie'
  text: string
  failed?: boolean
}

export function AskTheAgent({
  projectId,
  collapsed,
  onToggleCollapsed,
  onChanged
}: {
  projectId: string
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Reload from disk: the agent wrote to the same files through a process of its own. */
  onChanged: () => void | Promise<void>
}): JSX.Element {
  const [turns, setTurns] = useState<Turn[]>([])
  const [instruction, setInstruction] = useState('')
  const [working, setWorking] = useState(false)
  const [spent, setSpent] = useState(0)
  const sessionRef = useRef<string | undefined>(undefined)
  const endRef = useRef<HTMLDivElement>(null)

  // A conversation belongs to the project it is about. Opening another one starts again.
  useEffect(() => {
    setTurns([])
    setSpent(0)
    sessionRef.current = undefined
  }, [projectId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [turns, working])

  async function ask(): Promise<void> {
    const asked = instruction.trim()
    if (!asked || working) return

    setInstruction('')
    setTurns((said) => [...said, { from: 'you', text: asked }])
    setWorking(true)
    try {
      const outcome = await agentClient.instruct(projectId, asked, sessionRef.current)
      if (outcome.status === 'done') {
        sessionRef.current = outcome.sessionId ?? sessionRef.current
        if (outcome.costUsd) setSpent((total) => total + outcome.costUsd!)
        setTurns((said) => [...said, { from: 'talkie', text: outcome.say }])
      } else {
        setTurns((said) => [...said, { from: 'talkie', text: outcome.reason, failed: true }])
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setTurns((said) => [...said, { from: 'talkie', text, failed: true }])
    } finally {
      setWorking(false)
      // Whatever happened, the files may have moved under the editor.
      await onChanged()
    }
  }

  if (collapsed) {
    return (
      <aside className="flex h-full w-full flex-col items-center gap-2 overflow-hidden bg-surface px-2 py-3">
        <IconButton aria-label="Show the agent" onClick={onToggleCollapsed}>
          <PanelRightOpen size={16} />
        </IconButton>
        {/* The one thing worth saying at this width: it is still working. */}
        {working && <Thinking compact />}
      </aside>
    )
  }

  return (
    // Sized by the panel it is in rather than by itself: the edge beside it drags, so how much
    // room a conversation gets is the reader's to decide.
    <aside className="flex h-full w-full flex-col bg-surface">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3.5 py-2.5">
        <Sparkles size={13} className="shrink-0 text-accent" aria-hidden="true" />
        <h2 className="font-serif text-[14px] leading-none text-text">Ask Talkie</h2>
        {/* A run is not free, and the last one ran into a usage limit. Quiet, but there. */}
        {spent > 0 && (
          <span className="font-mono text-[10px] tabular-nums text-text-muted">
            ${spent.toFixed(2)}
          </span>
        )}
        <IconButton aria-label="Hide the agent" className="ml-auto" onClick={onToggleCollapsed}>
          <PanelRightClose size={16} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        {/* Capped even when the rail is dragged wide: a line of text that runs the width of
            half the window is one nobody can find their way back across. */}
        {turns.length === 0 && !working ? (
          <Opening />
        ) : (
          <ol className="mx-auto flex max-w-2xl flex-col gap-3.5">
            {turns.map((turn, index) => (
              <li key={index}>
                <Said turn={turn} />
              </li>
            ))}
            {working && (
              <li>
                <Thinking />
              </li>
            )}
          </ol>
        )}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-border p-2.5">
        <div className="mx-auto flex max-w-2xl items-end gap-1.5 rounded-lg border border-border bg-bg px-2.5 py-2 focus-within:border-accent">
          <textarea
            value={instruction}
            aria-label="Ask Talkie to change this project"
            placeholder={turns.length === 0 ? 'Add an introduction…' : 'Ask for another change…'}
            rows={1}
            disabled={working}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, shift-Enter writes a line: the same as everywhere else this shape
              // of box appears, so nobody has to find out which this one is.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void ask()
              }
            }}
            className="max-h-32 min-h-[1.25rem] w-full resize-none border-0 bg-transparent p-0 text-[12px] leading-relaxed text-text placeholder:text-text-muted focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            aria-label="Send"
            onClick={() => void ask()}
            disabled={working || !instruction.trim()}
            className="mb-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-0 bg-accent p-0 text-accent-foreground transition-opacity hover:bg-accent-hover disabled:opacity-25"
          >
            {working ? <Square size={9} fill="currentColor" /> : <ArrowUp size={12} />}
          </button>
        </div>
      </div>
    </aside>
  )
}

/** What this can be asked for, as things to ask rather than a description of a feature. */
function Opening(): JSX.Element {
  return (
    <div className="flex h-full flex-col justify-center gap-2.5">
      <p className="font-serif text-[13px] leading-relaxed text-text">
        Ask for a change to the whole project — not one clip.
      </p>
      <ul className="flex flex-col gap-1.5">
        {[
          'Add an introduction and a closing statement.',
          'The middle three all say the same thing — fix it.',
          'Make the narration less salesy throughout.'
        ].map((example) => (
          <li
            key={example}
            className="border-l border-paper-border pl-2.5 font-serif text-[12px] leading-relaxed text-text-muted"
          >
            {example}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * One turn.
 *
 * What was asked is set in a bubble because it is a thing someone typed; what came back is set
 * as prose, because it is Talkie talking about the project and the project's own writing
 * surface is serif. Two shapes rather than two colours of the same shape.
 */
function Said({ turn }: { turn: Turn }): JSX.Element {
  if (turn.from === 'you') {
    return (
      <p className="ml-6 rounded-lg rounded-br-sm bg-surface-hover px-2.5 py-1.5 text-[12px] leading-relaxed text-text">
        {turn.text}
      </p>
    )
  }

  return (
    <p
      className={cn(
        'border-l-2 pl-2.5 font-serif text-[13px] leading-relaxed',
        turn.failed ? 'border-l-danger text-danger' : 'border-l-accent text-text'
      )}
    >
      {turn.text}
    </p>
  )
}

/**
 * That it is working, and the one rule while it is.
 *
 * Three dots would say it is busy; this has to say more than that, because the agent is writing
 * the same files the editor is showing and the only safe thing to do meanwhile is nothing.
 */
function Thinking({ compact = false }: { compact?: boolean }): JSX.Element {
  const dots = (
    <span className="flex items-center gap-1" aria-label="Working">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
          style={{ animationDelay: `${dot * 180}ms` }}
        />
      ))}
    </span>
  )

  if (compact) return dots

  return (
    <div className="flex flex-col gap-1.5 border-l-2 border-l-accent pl-2.5">
      {dots}
      <p className="text-[11px] leading-relaxed text-text-muted">
        Reading the project and making the changes. Leave it be until it is done — it is writing
        the same files you are looking at. Undo puts the whole thing back.
      </p>
    </div>
  )
}
