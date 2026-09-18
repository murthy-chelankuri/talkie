import { useState } from 'react'
import { Loader2, PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react'
import { agentClient } from '../api/projectClient'
import { cn } from '../lib/cn'
import { IconButton } from './ui/IconButton'

/**
 * Asking Talkie to change the project, in a sentence.
 *
 * The app could already do one thing at a time on its own — rewrite this line, write that
 * slide. What it could not do was anything spanning a project: "add an introduction and a
 * closing statement", "the middle three all say the same thing". Each of those is several
 * operations whose shape depends on what is already there.
 *
 * It lives beside the video rather than inside the script, because what it changes is the
 * project and not only the words — filing it under Script said the opposite. The stage already
 * has the sources panel down one side; this is the other, so the shape of the screen says
 * where things come from and where they are asked for, with the demo itself in between.
 */
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
  const [instruction, setInstruction] = useState('')
  const [working, setWorking] = useState(false)
  const [said, setSaid] = useState<{ tone: 'done' | 'failed'; text: string } | null>(null)

  async function ask(): Promise<void> {
    const asked = instruction.trim()
    if (!asked || working) return

    setWorking(true)
    setSaid(null)
    try {
      const outcome = await agentClient.instruct(projectId, asked)
      if (outcome.status === 'done') {
        setInstruction('')
        setSaid({ tone: 'done', text: outcome.say })
      } else {
        setSaid({ tone: 'failed', text: outcome.reason })
      }
    } catch (err) {
      setSaid({ tone: 'failed', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setWorking(false)
      // Whatever happened, the files may have moved under the editor.
      await onChanged()
    }
  }

  if (collapsed) {
    return (
      <aside className="flex w-[3.75rem] shrink-0 flex-col items-center gap-2 border-l border-border bg-surface px-2 py-3">
        <IconButton aria-label="Show the agent" onClick={onToggleCollapsed}>
          <PanelRightOpen size={16} />
        </IconButton>
        {/* The one thing worth saying at this width: it is still working. */}
        {working && <Loader2 size={14} className="animate-spin text-accent" aria-label="Working" />}
      </aside>
    )
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 border-l border-border bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <Sparkles size={13} className="shrink-0 text-accent" aria-hidden="true" />
        <h2 className="font-serif text-[14px] leading-none text-text">Ask Talkie</h2>
        <IconButton aria-label="Hide the agent" className="ml-auto" onClick={onToggleCollapsed}>
          <PanelRightClose size={16} />
        </IconButton>
      </div>

      <p className="text-[11px] leading-relaxed text-text-muted">
        Changes the whole project, not one clip. It can write and rewrite narration, add scenes
        and split clips.
      </p>

      <textarea
        value={instruction}
        aria-label="Ask Talkie to change this project"
        placeholder="Add an introduction and a closing statement…"
        rows={4}
        disabled={working}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends, because this is one instruction rather than a paragraph. Shift-Enter
          // is still there for anyone spelling out several changes at once.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void ask()
          }
        }}
        className="w-full resize-none rounded-md border border-border bg-bg px-2.5 py-2 text-[12px] leading-relaxed text-text placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-60"
      />

      <button
        type="button"
        onClick={() => void ask()}
        disabled={working || !instruction.trim()}
        className="flex items-center justify-center gap-1.5 rounded-md border-0 bg-accent px-3 py-2 text-[12px] font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-40"
      >
        {working && <Loader2 size={13} className="animate-spin" />}
        {working ? 'Working' : 'Ask'}
      </button>

      {working && (
        // Said plainly because it is true, and because it is the one rule while this runs: the
        // agent is writing the same files the editor is showing.
        <p className="text-[11px] leading-relaxed text-text-muted">
          Reading the project and making the changes. Leave it be until it is done — it is
          writing the same files you are looking at. Undo puts the whole thing back.
        </p>
      )}

      {said && !working && (
        <p
          className={cn(
            'overflow-y-auto text-[12px] leading-relaxed',
            said.tone === 'done' ? 'text-text' : 'text-danger'
          )}
        >
          {said.text}
        </p>
      )}
    </aside>
  )
}
