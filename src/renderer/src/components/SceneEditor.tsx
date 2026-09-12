import { useEffect, useMemo, useState } from 'react'
import { LayoutTemplate, Share2, Sparkles, TriangleAlert, X } from 'lucide-react'
import { sceneClient, type TimelineItem } from '../api/projectClient'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Input } from './ui/Input'
import { Textarea } from './ui/Textarea'
import { Spinner } from './ui/Spinner'
import { cn } from '../lib/cn'

export type SceneKind = 'scene' | 'diagram'

export interface SceneDraft {
  title: string
  bullets: string[]
  source: string
}

const STARTER_DIAGRAM = 'flowchart LR\n  A[Record] --> B[Narrate]\n  B --> C[Export]'

function draftFrom(item: TimelineItem | null): { kind: SceneKind; draft: SceneDraft } {
  const data = (item?.data ?? {}) as { title?: string; bullets?: string[]; source?: string }
  return {
    kind: item?.kind === 'diagram' ? 'diagram' : 'scene',
    draft: {
      title: data.title ?? '',
      bullets: data.bullets ?? [],
      source: data.source ?? STARTER_DIAGRAM
    }
  }
}

/**
 * Write a slide or a diagram without leaving the app.
 *
 * The scene is edited as what it is — a heading and some lines, or mermaid source — rather than
 * as a picture, so it stays changeable afterwards. The instruction box is the same idea applied
 * to the model: it is told what the scene says now along with what to change, so asking twice
 * builds on the first answer rather than starting again.
 */
export function SceneEditor({
  projectId,
  projectName,
  item,
  onClose,
  onSaved
}: {
  projectId: string
  projectName: string
  /** The scene being edited, or null when writing a new one. */
  item: TimelineItem | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}): JSX.Element {
  const initial = useMemo(() => draftFrom(item), [item])
  const [kind, setKind] = useState<SceneKind>(initial.kind)
  const [draft, setDraft] = useState<SceneDraft>(initial.draft)
  const [instruction, setInstruction] = useState('')
  const [writing, setWriting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [diagramError, setDiagramError] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // The diagram is drawn as it is typed, so a mistake is seen rather than exported.
  useEffect(() => {
    if (kind !== 'diagram') return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const { renderMermaid } = await import('../lib/renderMermaid')
        const { svg: drawn } = await renderMermaid(draft.source)
        if (!cancelled) {
          setSvg(drawn)
          setDiagramError(null)
        }
      } catch (err) {
        if (!cancelled) setDiagramError(err instanceof Error ? err.message : String(err))
      }
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [kind, draft.source])

  async function askTheModel(): Promise<void> {
    if (!instruction.trim()) return
    setWriting(true)
    setError(null)
    try {
      const result = await sceneClient.write({
        kind,
        instruction: instruction.trim(),
        projectName,
        current:
          kind === 'scene'
            ? { title: draft.title, bullets: draft.bullets }
            : { source: draft.source }
      })

      if (result.status === 'failed') {
        setError(result.reason)
        return
      }

      const written = result.data as { title?: string; bullets?: string[]; source?: string }
      setDraft((current) => ({
        title: written.title ?? current.title,
        bullets: written.bullets ?? current.bullets,
        source: written.source ?? current.source
      }))
      setInstruction('')
    } finally {
      setWriting(false)
    }
  }

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      let data: unknown
      if (kind === 'scene') {
        if (!draft.title.trim()) {
          setError('A slide needs a title — it is the only thing guaranteed to be read.')
          return
        }
        data = { title: draft.title.trim(), bullets: draft.bullets.filter((line) => line.trim()) }
      } else {
        if (!svg) {
          setError(diagramError ?? 'The diagram has not been drawn yet.')
          return
        }
        // The drawn SVG is stored so the export never has to run mermaid itself.
        const src = await sceneClient.saveSvg(projectId, svg)
        data = { source: draft.source, src, ...(draft.title.trim() ? { title: draft.title.trim() } : {}) }
      }

      if (item) await sceneClient.update(projectId, item.id, data)
      else await sceneClient.add(projectId, kind, data)

      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label={item ? 'Edit scene' : 'Add a scene'}
        className="flex h-[36rem] max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
          <h2 className="font-serif text-lg text-text">{item ? 'Edit scene' : 'Add a scene'}</h2>

          {!item && (
            <div className="ml-2 flex items-center gap-1 rounded-lg border border-border p-0.5">
              {(
                [
                  { id: 'scene' as const, label: 'Slide', icon: <LayoutTemplate size={13} /> },
                  { id: 'diagram' as const, label: 'Diagram', icon: <Share2 size={13} /> }
                ]
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setKind(option.id)}
                  aria-pressed={kind === option.id}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border-0 px-2.5 py-1 text-[12px] transition-colors',
                    kind === option.id ? 'bg-accent text-accent-foreground' : 'bg-transparent text-text-muted'
                  )}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          )}

          <IconButton aria-label="Close" onClick={onClose} className="ml-auto">
            <X size={16} />
          </IconButton>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-[22rem] shrink-0 flex-col gap-3 overflow-y-auto border-r border-border p-4">
            {kind === 'scene' ? (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-text">Title</span>
                  <Input
                    aria-label="Scene title"
                    value={draft.title}
                    placeholder="How it works"
                    onChange={(event) => setDraft((d) => ({ ...d, title: event.target.value }))}
                  />
                </label>
                <label className="flex min-h-0 flex-1 flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-text">Lines</span>
                  <Textarea
                    aria-label="Scene lines"
                    value={draft.bullets.join('\n')}
                    placeholder={'One line per row\nKeep them short'}
                    onChange={(event) =>
                      setDraft((d) => ({ ...d, bullets: event.target.value.split('\n') }))
                    }
                    className="min-h-[8rem] flex-1 resize-none font-serif"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-text">Title (optional)</span>
                  <Input
                    aria-label="Diagram title"
                    value={draft.title}
                    placeholder="How a session becomes a video"
                    onChange={(event) => setDraft((d) => ({ ...d, title: event.target.value }))}
                  />
                </label>
                <label className="flex min-h-0 flex-1 flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-text">Mermaid</span>
                  <Textarea
                    aria-label="Diagram source"
                    value={draft.source}
                    onChange={(event) => setDraft((d) => ({ ...d, source: event.target.value }))}
                    className="min-h-[10rem] flex-1 resize-none font-mono text-[12px]"
                  />
                </label>
                {diagramError && (
                  <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
                    <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {diagramError}
                  </p>
                )}
              </>
            )}

            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-bg p-3">
              <span className="text-[13px] font-medium text-text">Ask for a change</span>
              <span className="text-[11px] leading-relaxed text-text-muted">
                Say what you want different. It is told what the scene says now, so you can keep
                asking.
              </span>
              <Textarea
                aria-label="Scene instruction"
                value={instruction}
                placeholder={kind === 'scene' ? 'Make it three steps, shorter' : 'Add a path for a failed export'}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void askTheModel()
                }}
                className="min-h-[4rem] resize-none text-[13px]"
              />
              <Button size="sm" disabled={writing || !instruction.trim()} onClick={askTheModel}>
                {writing ? <Spinner size="sm" /> : <Sparkles size={13} />}
                {writing ? 'Writing…' : 'Write it'}
              </Button>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-center bg-bg p-4">
            <ScenePreview kind={kind} draft={draft} svg={svg} />
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-border px-5 py-3">
          <span className="text-[11px] text-danger">{error}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={save}>
              {saving ? <Spinner size="sm" /> : item ? 'Save scene' : 'Add to timeline'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/** The scene as it will appear, drawn the same way the composition draws it. */
function ScenePreview({
  kind,
  draft,
  svg
}: {
  kind: SceneKind
  draft: SceneDraft
  svg: string | null
}): JSX.Element {
  return (
    <div
      className="aspect-video max-h-full w-full overflow-hidden rounded-lg shadow-lg ring-1 ring-border"
      style={{ background: 'linear-gradient(160deg, #232833 0%, #171b22 55%, #101318 100%)' }}
    >
      {kind === 'scene' ? (
        <div className="flex h-full flex-col justify-center px-[9%]">
          <h3 className="font-serif text-[clamp(18px,3.4vw,42px)] leading-tight text-[#f4f6f9]">
            {draft.title || 'Your title'}
          </h3>
          <div className="mt-3 h-[3px] w-14 rounded bg-accent" />
          <ul className="mt-5 flex flex-col gap-2">
            {draft.bullets
              .filter((line) => line.trim())
              .map((line, index) => (
                <li key={index} className="flex items-baseline gap-2.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span className="text-[clamp(10px,1.7vw,21px)] leading-snug text-[#c9cedb]">{line}</span>
                </li>
              ))}
          </ul>
        </div>
      ) : (
        <div className="flex h-full flex-col p-[5%]">
          {draft.title.trim() && (
            <h3 className="mb-3 font-serif text-[clamp(14px,2.4vw,30px)] text-[#f4f6f9]">{draft.title}</h3>
          )}
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {svg ? (
              <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <Spinner size="md" label="Drawing the diagram" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
