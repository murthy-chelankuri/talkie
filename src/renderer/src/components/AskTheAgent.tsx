import { useState } from 'react'
import { Loader2, CornerDownLeft } from 'lucide-react'
import { agentClient } from '../api/projectClient'
import { cn } from '../lib/cn'

/**
 * Asking Talkie to change the project, in a sentence.
 *
 * The app could already do one thing at a time on its own — rewrite this line, write that
 * slide. What it could not do was anything spanning a project: "add an introduction and a
 * closing statement", "the middle three all say the same thing". Each of those is several
 * operations whose shape depends on what is already there, which is the kind of thing only an
 * agent that can look first can do.
 *
 * It sits on the script rather than the timeline because that is where the project reads as a
 * whole, and the whole is what these instructions are about.
 */
export function AskTheAgent({
  projectId,
  onChanged
}: {
  projectId: string
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

  return (
    <div className="border-b border-paper-border pb-4">
      <div className="flex items-start gap-2">
        <textarea
          value={instruction}
          aria-label="Ask Talkie to change this project"
          placeholder="Add an introduction and a closing statement…"
          rows={2}
          disabled={working}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, because this is one instruction rather than a paragraph. A newline
            // is still there for anyone who wants to spell out several changes at once.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void ask()
            }
          }}
          className="min-w-0 flex-1 resize-none rounded-md border border-paper-border bg-surface px-3 py-2 font-sans text-[13px] leading-relaxed text-text placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={working || !instruction.trim()}
          className="flex items-center gap-1.5 rounded-md border-0 bg-accent px-3 py-2 text-[12px] font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-40"
        >
          {working ? <Loader2 size={13} className="animate-spin" /> : <CornerDownLeft size={13} />}
          {working ? 'Working' : 'Ask'}
        </button>
      </div>

      {working && (
        // Said plainly because it is true and because it is the one rule while this runs: the
        // agent is writing the same files the editor is showing.
        <p className="mt-2 text-[11px] text-text-muted">
          Reading the project and making the changes. Leave it be until it is done — it is
          writing the same files you are looking at. Undo puts the whole thing back.
        </p>
      )}

      {said && !working && (
        <p
          className={cn(
            'mt-2 text-[12px] leading-relaxed',
            said.tone === 'done' ? 'text-text' : 'text-danger'
          )}
        >
          {said.text}
        </p>
      )}
    </div>
  )
}
