import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Check, Plus, Sparkles, Square, X } from 'lucide-react'
import { agentClient, type TimelineItem } from '../api/projectClient'
import { richTextToPlain } from '../../../main/project/timeline/richText'
import { cn } from '../lib/cn'
import { IconButton } from './ui/IconButton'
import { useElapsedSeconds } from './ui/Working'

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
 *
 * Scenes can be pointed at. Asking about one scene was what people most wanted and could not
 * say — "make this shorter" in a project of twenty scenes was a guess. The clip selected on the
 * timeline is offered as one click; any scene can be added from the list; the agent is told which
 * ones are meant, every turn (projectAgent.ts, describeScenes).
 */

export interface Turn {
  from: 'you' | 'talkie'
  text: string
  failed?: boolean
  /** The scenes this turn was about, as they were named when it was sent. */
  about?: string[]
}

const NO_CLIPS: TimelineItem[] = []

const KIND_NAMES: Record<string, string> = { scene: 'Slide', video: 'Recording', image: 'Picture', diagram: 'Diagram', html: 'HTML scene' }

/** "Scene 3 · How it works", or "Scene 3 · Recording" for a clip with no title. */
export function sceneName(timeline: TimelineItem[], id: string): string {
  const index = timeline.findIndex((item) => item.id === id)
  if (index === -1) return 'A scene'
  const item = timeline[index]
  const title = richTextToPlain((item.data as { title?: string } | null)?.title ?? '').trim()
  return `Scene ${index + 1} · ${title || KIND_NAMES[item.kind] || 'Clip'}`
}

export function AskTheAgent({
  projectId,
  onClose,
  onWorkingChange,
  onChanged,
  timeline = NO_CLIPS,
  selectedItemId = null
}: {
  projectId: string
  onClose: () => void
  /** Told when a run starts and ends, so the rail can say so while this panel is shut. */
  onWorkingChange?: (working: boolean) => void
  /** Reload from disk: the agent wrote to the same files through a process of its own. */
  onChanged: () => void | Promise<void>
  /** The project's clips, to name and pick scenes from. */
  timeline?: TimelineItem[]
  /** The clip selected in the editor, offered as the scene being asked about. */
  selectedItemId?: string | null
}): JSX.Element {
  const [turns, setTurns] = useState<Turn[]>([])
  const [instruction, setInstruction] = useState('')
  const [working, setWorking] = useState(false)
  const [spent, setSpent] = useState(0)
  const [about, setAbout] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const sessionRef = useRef<string | undefined>(undefined)
  const endRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)

  // A conversation belongs to the project it is about. Opening another one starts again.
  useEffect(() => {
    setTurns([])
    setSpent(0)
    setAbout([])
    sessionRef.current = undefined
  }, [projectId])

  // A scene deleted while it was picked is not something to ask about.
  useEffect(() => {
    setAbout((picked) => {
      const kept = picked.filter((id) => timeline.some((item) => item.id === id))
      return kept.length === picked.length ? picked : kept
    })
  }, [timeline])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [turns, working])

  useEffect(() => {
    onWorkingChange?.(working)
  }, [working, onWorkingChange])

  async function ask(): Promise<void> {
    const asked = instruction.trim()
    if (!asked || working) return

    const scenes = about.filter((id) => timeline.some((item) => item.id === id))
    setInstruction('')
    setTurns((said) => [...said, { from: 'you', text: asked, about: scenes.map((id) => sceneName(timeline, id)) }])
    setWorking(true)
    try {
      const outcome = await agentClient.instruct(projectId, asked, sessionRef.current, scenes)
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

  function toggle(id: string): void {
    setAbout((picked) => (picked.includes(id) ? picked.filter((each) => each !== id) : [...picked, id]))
  }

  function fill(text: string): void {
    setInstruction(text)
    boxRef.current?.focus()
  }

  const offered = selectedItemId && !about.includes(selectedItemId) && timeline.some((item) => item.id === selectedItemId) ? selectedItemId : null

  return (
    // Sized by the panel it is in rather than by itself: the edge beside it drags, so how much
    // room a conversation gets is the reader's to decide. Kept mounted while its panel is shut,
    // so neither the conversation nor a run in progress is lost by looking at something else.
    <aside aria-label="Agent conversation" className="flex h-full w-full flex-col rounded-xl bg-surface">
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
        <Sparkles size={14} className="shrink-0 text-accent" aria-hidden="true" />
        <h2 className="font-serif text-[15px] leading-none text-text">Ask Talkie</h2>
        {/* A run is not free, and the last one ran into a usage limit. Quiet, but there. */}
        {spent > 0 && <span className="font-mono text-[10px] tabular-nums text-text-muted">${spent.toFixed(2)}</span>}
        <IconButton aria-label="Close the agent" className="-mr-1.5 ml-auto" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {/* Capped even when the rail is dragged wide: a line of text that runs the width of
            half the window is one nobody can find their way back across. */}
        {turns.length === 0 && !working ? (
          <Opening onPick={fill} aboutScenes={about.length > 0} />
        ) : (
          <ol className="mx-auto flex max-w-2xl flex-col gap-4">
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

      <div className="shrink-0 p-3">
        <div className="mx-auto flex max-w-2xl flex-col gap-2 rounded-xl bg-raised p-2.5 focus-within:ring-2 focus-within:ring-accent">
          {/* What the message is about: the scenes picked, the one selected on offer, and the list. */}
          <div className="relative flex flex-wrap items-center gap-1.5">
            {about.map((id) => (
              <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-accent/15 py-0.5 pl-2 pr-1 text-[12px] text-accent">
                <span className="truncate">{sceneName(timeline, id)}</span>
                <button
                  type="button"
                  aria-label={`Stop asking about ${sceneName(timeline, id)}`}
                  onClick={() => toggle(id)}
                  className="flex h-4 w-4 items-center justify-center rounded-sm border-0 bg-transparent p-0 text-accent hover:bg-accent/20"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {offered && (
              <button
                type="button"
                onClick={() => toggle(offered)}
                title="Ask about the clip selected on the timeline"
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-dashed border-border bg-transparent px-2 py-0.5 text-[12px] text-text-muted hover:border-accent hover:text-accent"
              >
                <Plus size={11} aria-hidden="true" />
                <span className="truncate">{sceneName(timeline, offered)}</span>
              </button>
            )}
            {timeline.length > 0 && (
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={picking}
                onClick={() => setPicking((open) => !open)}
                className="inline-flex items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-[12px] text-text-muted hover:text-text"
              >
                <Plus size={11} aria-hidden="true" />
                {about.length === 0 && !offered ? 'Ask about a scene' : 'Add a scene'}
              </button>
            )}
            {picking && <ScenePicker timeline={timeline} picked={about} onToggle={toggle} onClose={() => setPicking(false)} />}
          </div>

          <div className="flex items-end gap-2">
            <textarea
              ref={boxRef}
              value={instruction}
              aria-label="Ask Talkie to change this project"
              placeholder={
                about.length > 0
                  ? about.length === 1
                    ? 'What should change in this scene?'
                    : 'What should change in these scenes?'
                  : turns.length === 0
                    ? 'Ask for a change — to the whole project, or pick a scene above'
                    : 'Ask for another change…'
              }
              rows={2}
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
              className="max-h-40 min-h-11 w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-relaxed text-text placeholder:text-text-muted focus:outline-hidden disabled:opacity-60"
            />
            {working ? (
              // A real stop: a run can take minutes, and what looked like Stop used to be disabled.
              <button
                type="button"
                aria-label="Stop"
                title="Stop. What it already changed stays — Undo takes the whole run back."
                onClick={() => void agentClient.stop(projectId)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 bg-danger p-0 text-white hover:brightness-110"
              >
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Send"
                title="Send (Enter). Shift-Enter for a new line."
                onClick={() => void ask()}
                disabled={!instruction.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 bg-accent-fill p-0 text-white transition-opacity hover:brightness-110 disabled:opacity-30"
              >
                <ArrowUp size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}

/** Every scene, to tick the ones being asked about. */
function ScenePicker({
  timeline,
  picked,
  onToggle,
  onClose
}: {
  timeline: TimelineItem[]
  picked: string[]
  onToggle: (id: string) => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Scenes to ask about"
      aria-multiselectable="true"
      className="absolute bottom-[calc(100%+8px)] left-0 z-50 max-h-72 w-72 overflow-y-auto rounded-xl bg-raised p-1.5 shadow-xl ring-1 ring-border"
    >
      {timeline.map((item) => {
        const on = picked.includes(item.id)
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={on}
            onClick={() => onToggle(item.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md border-0 px-2.5 py-1.5 text-left text-[13px] text-text',
              on ? 'bg-surface-hover' : 'bg-transparent hover:bg-surface-hover'
            )}
          >
            <span className="w-3.5 shrink-0">{on && <Check size={13} className="text-accent" />}</span>
            <span className="min-w-0 flex-1 truncate">{sceneName(timeline, item.id)}</span>
          </button>
        )
      })}
    </div>
  )
}

/** What this can be asked for, as things to ask — and pressing one puts it in the box. */
function Opening({ onPick, aboutScenes }: { onPick: (text: string) => void; aboutScenes: boolean }): JSX.Element {
  const examples = aboutScenes
    ? ['Make the narration shorter and plainer.', 'Rewrite the slide to match what is said.', 'Split this into two scenes.']
    : ['Add an introduction and a closing statement.', 'The middle three all say the same thing — fix it.', 'Make the narration less salesy throughout.']
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <p className="font-serif text-[14px] leading-relaxed text-text">
        {aboutScenes
          ? 'Ask for a change to the scenes you picked.'
          : 'Ask for a change to the whole project — or pick a scene below to ask about just that one.'}
      </p>
      <ul className="flex flex-col gap-1.5">
        {examples.map((example) => (
          <li key={example}>
            <button
              type="button"
              onClick={() => onPick(example)}
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-left font-serif text-[13px] leading-relaxed text-text-muted hover:border-accent hover:text-text"
            >
              {example}
            </button>
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
      <div className="ml-8 flex flex-col items-end gap-1">
        {turn.about && turn.about.length > 0 && (
          <span className="flex flex-wrap justify-end gap-1">
            {turn.about.map((name) => (
              <span key={name} className="rounded-sm bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent">
                {name}
              </span>
            ))}
          </span>
        )}
        <p className="whitespace-pre-wrap rounded-lg rounded-br-sm bg-surface-hover px-3 py-2 text-[13px] leading-relaxed text-text">{turn.text}</p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 border-l-2 pl-3 font-serif text-[14px] leading-relaxed',
        turn.failed ? 'border-l-danger text-danger' : 'border-l-accent text-text'
      )}
    >
      {formatReply(turn.text)}
    </div>
  )
}

/**
 * The agent's answer with the little formatting it uses — paragraphs, lists, **bold** and
 * `names` — drawn as such. Built as elements, never as markup: it is a model's text.
 */
export function formatReply(text: string): ReactNode[] {
  const blocks = text.trim().split(/\n\s*\n/)
  return blocks.map((block, index) => {
    const lines = block.split('\n')
    const listed = lines.every((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line))
    if (listed) {
      const ordered = /^\s*\d/.test(lines[0])
      const items = lines.map((line, at) => <li key={at}>{inline(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''))}</li>)
      return ordered ? (
        <ol key={index} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={index} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      )
    }
    return (
      <p key={index}>
        {lines.map((line, at) => (
          <Fragment key={at}>
            {at > 0 && <br />}
            {inline(line)}
          </Fragment>
        ))}
      </p>
    )
  })
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, index) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code key={index} className="rounded-sm bg-raised px-1 font-mono text-[12px]">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <Fragment key={index}>{part}</Fragment>
  })
}

/**
 * That it is working, how long it has been, and the one rule while it is.
 *
 * Three dots would say it is busy; this has to say more than that, because the agent is writing
 * the same files the editor is showing and the only safe thing to do meanwhile is nothing.
 */
function Thinking(): JSX.Element {
  const seconds = useElapsedSeconds(true)
  return (
    <div className="flex flex-col gap-1.5 border-l-2 border-l-accent pl-3">
      <span className="flex items-center gap-2 text-[12px] font-medium text-accent" aria-label="Working">
        <span className="flex items-center gap-1">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" style={{ animationDelay: `${dot * 180}ms` }} />
          ))}
        </span>
        Working… <span className="tabular-nums text-text-muted">{seconds}s</span>
      </span>
      <p className="text-[12px] leading-relaxed text-text-muted">
        Reading the project and making the changes. Leave it be until it is done — it is writing the same files you are
        looking at. Stop ends it; Undo puts the whole thing back.
      </p>
    </div>
  )
}
