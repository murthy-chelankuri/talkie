import { useEffect, useMemo, useState } from 'react'
import { LayoutTemplate, Share2, Sparkles, TriangleAlert, X } from 'lucide-react'
import { sceneClient, type TimelineItem } from '../api/projectClient'
import { RichTextField } from './RichTextField'
import { plainToRichText, richTextToPlain } from '../../../main/project/timeline/richText'
import { VARIANT_FOR, resolveSceneTheme } from '../../../remotion/sceneTheme'
import type { RenderTheme } from '../../../remotion/renderTheme'
import type { SceneStyle } from '../../../main/project/timeline/schema'
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
  style: SceneStyle
}

const DEFAULT_STYLE: SceneStyle = {
  theme: 'dark',
  font: 'serif',
  align: 'left',
  size: 'regular',
  accent: '#7ab5f0'
}

const STARTER_DIAGRAM = 'flowchart LR\n  A[Record] --> B[Narrate]\n  B --> C[Export]'

function draftFrom(item: TimelineItem | null): { kind: SceneKind; draft: SceneDraft } {
  const data = (item?.data ?? {}) as {
    title?: string
    bullets?: string[]
    source?: string
    style?: SceneStyle
  }

  return {
    kind: item?.kind === 'diagram' ? 'diagram' : 'scene',
    draft: {
      title: data.title ?? '',
      bullets: data.bullets ?? [],
      source: data.source ?? STARTER_DIAGRAM,
      style: { ...DEFAULT_STYLE, ...(data.style ?? {}) }
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
  theme = null,
  onClose,
  onSaved
}: {
  projectId: string
  projectName: string
  /** The scene being edited, or null when writing a new one. */
  item: TimelineItem | null
  /** The project's theme, which the preview and the choice of look follow. */
  theme?: RenderTheme | null
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
        // The model reads and writes plain words; the markup is the editor's business.
        current:
          kind === 'scene'
            ? { title: richTextToPlain(draft.title), bullets: draft.bullets.map(richTextToPlain) }
            : { source: draft.source }
      })

      if (result.status === 'failed') {
        setError(result.reason)
        return
      }

      const written = result.data as { title?: string; bullets?: string[]; source?: string }
      setDraft((current) => ({
        ...current,
        title: written.title !== undefined ? plainToRichText(written.title) : current.title,
        bullets: written.bullets ? written.bullets.map(plainToRichText) : current.bullets,
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
        if (!richTextToPlain(draft.title).trim()) {
          setError('A slide needs a title — it is the only thing guaranteed to be read.')
          return
        }
        data = {
          title: draft.title.trim(),
          bullets: draft.bullets.filter((line) => richTextToPlain(line).trim()),
          style: draft.style
        }
      } else {
        if (!svg) {
          setError(diagramError ?? 'The diagram has not been drawn yet.')
          return
        }
        // The drawn SVG is stored so the export never has to run mermaid itself.
        const src = await sceneClient.saveSvg(projectId, svg)
        data = {
          source: draft.source,
          src,
          style: draft.style,
          ...(richTextToPlain(draft.title).trim() ? { title: draft.title.trim() } : {})
        }
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
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-text">Title</span>
                  <RichTextField
                    ariaLabel="Scene title"
                    value={draft.title}
                    placeholder="How it works"
                    onChange={(title) => setDraft((d) => ({ ...d, title }))}
                    className="font-serif text-[15px]"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13px] font-medium text-text">Lines</span>
                    <button
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, bullets: [...d.bullets, ''] }))}
                      className="rounded border-0 bg-transparent px-1 py-0 text-[11px] text-accent hover:underline"
                    >
                      Add a line
                    </button>
                  </div>
                  {draft.bullets.length === 0 && (
                    <p className="text-[11px] text-text-muted">No lines yet — a title on its own is fine.</p>
                  )}
                  {draft.bullets.map((line, index) => (
                    <div key={index} className="flex items-start gap-1.5">
                      <div className="min-w-0 flex-1">
                        <RichTextField
                          ariaLabel={`Line ${index + 1}`}
                          value={line}
                          placeholder="Keep it short"
                          onChange={(html) =>
                            setDraft((d) => ({
                              ...d,
                              bullets: d.bullets.map((existing, i) => (i === index ? html : existing))
                            }))
                          }
                        />
                      </div>
                      <IconButton
                        aria-label={`Remove line ${index + 1}`}
                        className="mt-9 h-6 w-6 shrink-0"
                        onClick={() =>
                          setDraft((d) => ({ ...d, bullets: d.bullets.filter((_, i) => i !== index) }))
                        }
                      >
                        <X size={12} />
                      </IconButton>
                    </div>
                  ))}
                </div>
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
                {/* Not flex-1: as a growing item in a column that scrolls, this collapsed to
                    nothing as soon as the cards below it filled the panel — which left no way to
                    type a diagram at all. A solid height, and the panel scrolls instead. */}
                <label className="flex shrink-0 flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-text">Mermaid</span>
                  <Textarea
                    aria-label="Diagram source"
                    value={draft.source}
                    placeholder={'flowchart LR\n  A[Record] --> B[Narrate] --> C[Export]'}
                    onChange={(event) => setDraft((d) => ({ ...d, source: event.target.value }))}
                    className="min-h-[11rem] resize-y font-mono text-[12px] leading-relaxed"
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

            <SceneStyleControls
              style={draft.style}
              onChange={(style) => setDraft((d) => ({ ...d, style: { ...d.style, ...style } }))}
              showTypography={kind === 'scene'}
              theme={theme}
            />

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
            <ScenePreview kind={kind} draft={draft} svg={svg} theme={theme} />
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

/**
 * The three variants of the project's theme — or, in a project without one, the palettes they
 * stand for. Older slides may still carry a palette name; they show as the variant it maps to.
 */
const VARIANT_CHOICES: Array<{ id: 'brand' | 'light' | 'dark'; label: string }> = [
  { id: 'brand', label: 'Brand' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
]

/** How the scene looks, as a small set of decisions rather than a stylesheet. */
function SceneStyleControls({
  style,
  onChange,
  showTypography,
  theme
}: {
  style: SceneStyle
  onChange: (next: Partial<SceneStyle>) => void
  showTypography: boolean
  /** The project's theme. With one, colour and font are its to decide, so those controls go. */
  theme: RenderTheme | null
}): JSX.Element {
  const current = VARIANT_FOR[style.theme] ?? 'dark'

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-3">
      <span className="text-[13px] font-medium text-text">Look</span>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-text-muted">Background</span>
        <div className="flex gap-1.5">
          {VARIANT_CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              aria-label={choice.label}
              aria-pressed={current === choice.id}
              title={choice.label}
              onClick={() => onChange({ theme: choice.id })}
              className={cn(
                'h-7 flex-1 rounded-md border p-0 transition-colors',
                current === choice.id ? 'border-accent ring-1 ring-accent' : 'border-border'
              )}
              style={{ background: resolveSceneTheme({ ...style, theme: choice.id }, theme).background }}
            />
          ))}
        </div>
      </div>

      {/* A theme sets the accent; a slide choosing its own is how it goes off-brand. */}
      {!theme && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-text-muted">Accent</span>
          <div className="flex items-center gap-1.5">
            {['#7ab5f0', '#5eead4', '#c4b5fd', '#f87171', '#ffffff'].map((colour) => (
              <button
                key={colour}
                type="button"
                aria-label={`Accent ${colour}`}
                aria-pressed={style.accent === colour}
                onClick={() => onChange({ accent: colour })}
                className={cn(
                  'h-5 w-5 rounded-full border p-0',
                  style.accent === colour ? 'border-accent ring-1 ring-accent' : 'border-border'
                )}
                style={{ background: colour }}
              />
            ))}
            <input
              type="color"
              aria-label="Pick an accent colour"
              value={style.accent}
              onChange={(event) => onChange({ accent: event.target.value })}
              className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
            />
          </div>
        </div>
      )}

      {showTypography && (
        <div className={cn('grid gap-2', theme ? 'grid-cols-2' : 'grid-cols-3')}>
          {!theme && (
            <Choice
              label="Font"
              value={style.font}
              options={[
                { id: 'serif', label: 'Serif' },
                { id: 'sans', label: 'Sans' }
              ]}
              onChange={(font) => onChange({ font: font as SceneStyle['font'] })}
            />
          )}
          <Choice
            label="Align"
            value={style.align}
            options={[
              { id: 'left', label: 'Left' },
              { id: 'center', label: 'Centre' }
            ]}
            onChange={(align) => onChange({ align: align as SceneStyle['align'] })}
          />
          <Choice
            label="Size"
            value={style.size}
            options={[
              { id: 'regular', label: 'Regular' },
              { id: 'large', label: 'Large' }
            ]}
            onChange={(size) => onChange({ size: size as SceneStyle['size'] })}
          />
        </div>
      )}
    </div>
  )
}

function Choice({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: Array<{ id: string; label: string }>
  onChange: (id: string) => void
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-text-muted">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-[12px] text-text"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The scene as it will appear, drawn the same way the composition draws it. */
function ScenePreview({
  kind,
  draft,
  svg,
  theme
}: {
  kind: SceneKind
  draft: SceneDraft
  svg: string | null
  theme: RenderTheme | null
}): JSX.Element {
  // Drawn from the same theme the composition uses, so the preview is not a second opinion.
  const look = resolveSceneTheme(draft.style, theme)
  const centred = look.align === 'center'

  return (
    <div
      className="aspect-video max-h-full w-full overflow-hidden rounded-lg shadow-lg ring-1 ring-border"
      style={{ background: look.background }}
    >
      {kind === 'scene' ? (
        <div
          className="flex h-full flex-col justify-center px-[9%]"
          style={{ textAlign: look.align, alignItems: centred ? 'center' : 'stretch' }}
        >
          <h3
            className="text-[clamp(18px,3.4vw,42px)] leading-tight"
            style={{ fontFamily: look.headingFont, color: look.heading }}
            dangerouslySetInnerHTML={{ __html: draft.title || 'Your title' }}
          />
          <div
            className="mt-3 h-[3px] w-14 rounded"
            style={{ background: look.accent, marginLeft: centred ? 'auto' : undefined, marginRight: centred ? 'auto' : undefined }}
          />
          <ul className="mt-5 flex flex-col gap-2">
            {draft.bullets
              .filter((line) => richTextToPlain(line).trim())
              .map((line, index) => (
                <li
                  key={index}
                  className="flex items-baseline gap-2.5"
                  style={{ justifyContent: centred ? 'center' : 'flex-start' }}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: look.accent }} />
                  <span
                    className="text-[clamp(10px,1.7vw,21px)] leading-snug"
                    style={{ color: look.body }}
                    dangerouslySetInnerHTML={{ __html: line }}
                  />
                </li>
              ))}
          </ul>
        </div>
      ) : (
        <div className="flex h-full flex-col p-[5%]">
          {richTextToPlain(draft.title).trim() && (
            <h3
              className="mb-3 text-[clamp(14px,2.4vw,30px)]"
              style={{ fontFamily: look.headingFont, color: look.heading }}
              dangerouslySetInnerHTML={{ __html: draft.title }}
            />
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
