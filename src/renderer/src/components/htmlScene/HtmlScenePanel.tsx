import { useEffect, useMemo, useRef, useState } from 'react'
import { Preview, type PreviewHandle } from '../../../../video/preview'
import { FolderInput, Sparkles, TriangleAlert } from 'lucide-react'
import {
  htmlSceneClient,
  timelineClient,
  type HtmlSceneData,
  type HtmlSceneResult,
  type TimelineItem
} from '../../api/projectClient'
import type { RenderTheme } from '../../../../composition/renderTheme'
import type { TimelineItem as CompositionTimelineItem } from '../../../../composition/types'
import { DemoComposition } from '../../../../composition/DemoComposition'
import { FPS, HEIGHT, WIDTH } from '../../../../composition/constants'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { Spinner } from '../ui/Spinner'
import { cn } from '../../lib/cn'
import { CodePanel } from './CodePanel'
import { ParamsForm } from './ParamsForm'
import { Input } from '../ui/Input'
import { lengthInDescription, parseLength } from '../../lib/sceneLength'
import { Working } from '../ui/Working'

const LOOKS = [
  { id: 'brand', label: 'Brand' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
] as const

/**
 * An HTML scene in the scene dialog — the one kind of scene added now, since its templates are
 * slides, steps, timelines and charts: a gallery to start from, then a form for what it says, its
 * look, the AI and the code, beside the scene playing as the video will play it.
 */
export function HtmlScenePanel({
  projectId,
  item,
  theme,
  onSaved,
  onClose
}: {
  projectId: string
  item: TimelineItem | null
  theme: RenderTheme | null
  onSaved: () => void | Promise<void>
  onClose: () => void
}): JSX.Element {
  const [current, setCurrent] = useState<TimelineItem | null>(item)
  const [warnings, setWarnings] = useState<string[]>([])

  /** The clip as the timeline resolves it — the page as a URL the preview can load. */
  async function arrived(result: HtmlSceneResult): Promise<void> {
    setWarnings(result.warnings)
    const fresh = (await timelineClient.read(projectId)).find((clip) => clip.id === result.item.id)
    setCurrent(fresh ?? result.item)
    await onSaved()
  }

  if (!current) return <StartHtmlScene projectId={projectId} onCreated={arrived} />
  return <EditHtmlScene key={current.id} projectId={projectId} item={current} theme={theme} warnings={warnings} onSaved={arrived} onClose={onClose} />
}

type Template = Awaited<ReturnType<typeof htmlSceneClient.templates>>[number]

/** The gallery's order: what most scenes are, first. */
const CATEGORIES = ['Slides', 'Diagrams', 'Data', 'Motion', 'Code']

/**
 * Starting a scene: a picture of every template, grouped by what it is for — a slide, steps, a
 * chart — so the first choice is made by looking rather than by reading descriptions; or
 * describing it to the AI; or importing a page. A template starts with its values filled in, and
 * the form to change them is what opens next.
 */
function StartHtmlScene({ projectId, onCreated }: { projectId: string; onCreated: (result: HtmlSceneResult) => Promise<void> }): JSX.Element {
  const [description, setDescription] = useState('')
  const [length, setLength] = useState('')
  const [templates, setTemplates] = useState<Template[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void htmlSceneClient.templates().then(setTemplates)
  }, [])

  async function run(label: string, action: () => Promise<HtmlSceneResult | null | { status: 'failed'; reason: string } | ({ status: 'written' } & HtmlSceneResult)>): Promise<void> {
    setBusy(label)
    setError(null)
    try {
      const result = await action()
      if (!result) return
      if ('status' in result && result.status === 'failed') setError(result.reason)
      else await onCreated(result as HtmlSceneResult)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(null)
    }
  }

  const groups = [...CATEGORIES, ...new Set(templates.map((t) => t.category).filter((c) => !CATEGORIES.includes(c)))]
    .map((category) => ({ category, templates: templates.filter((t) => t.category === category) }))
    .filter((group) => group.templates.length > 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
      {groups.map((group) => (
        <section key={group.category} aria-label={group.category} className="flex flex-col gap-2">
          <span className="text-[12px] font-medium uppercase tracking-wide text-text-muted">{group.category}</span>
          <div className="grid grid-cols-3 gap-3">
            {group.templates.map((template) => (
              <button
                key={template.id}
                type="button"
                aria-label={`Start from ${template.name}`}
                disabled={busy !== null}
                onClick={() => void run(template.id, () => htmlSceneClient.fromTemplate(projectId, template.id, template.name))}
                className="group flex flex-col overflow-hidden rounded-xl border border-border bg-raised p-0 text-left transition-colors hover:border-accent disabled:opacity-60"
              >
                <span className="relative block aspect-video w-full bg-bg">
                  {template.thumbnail && <img src={template.thumbnail} alt="" className="h-full w-full object-cover" />}
                  {busy === template.id && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Spinner size="md" label="Adding" />
                    </span>
                  )}
                </span>
                <span className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="text-[13px] font-medium text-text">{template.name}</span>
                  <span className="text-[11px] leading-snug text-text-muted">{template.description}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <section className="flex flex-col gap-2 rounded-xl bg-raised p-4">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-text">
          <Sparkles size={14} className="text-accent" /> Or describe it
        </span>
        <span className="text-[11px] leading-relaxed text-text-muted">
          Your AI model writes the page, in this project&rsquo;s theme and timed to its narration. Talkie checks it before it reaches the timeline.
        </span>
        <Textarea
          aria-label="Describe the scene"
          value={description}
          placeholder="An animated bar chart of Q3 revenue by region; each bar grows as its region is mentioned"
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-18 text-[13px]"
        />
        <label className="flex items-center gap-2 text-[12px] text-text-muted">
          Length
          <Input
            aria-label="Length"
            value={length}
            placeholder={lengthInDescription(description) ? describeSeconds(lengthInDescription(description)!) : '5s'}
            onChange={(e) => setLength(e.target.value)}
            className="h-7 w-28 text-[12px]"
          />
          <span>
            {length.trim() && !parseLength(length)
              ? 'Try 10s, 2 min or 1:30'
              : 'The page is paced for it. Long, busy scenes take a model a few minutes to write.'}
          </span>
        </label>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={busy !== null || !description.trim() || Boolean(length.trim() && !parseLength(length))}
            onClick={() =>
              void run('describe', () =>
                htmlSceneClient.describe(projectId, description.trim(), parseLength(length) ?? lengthInDescription(description) ?? undefined)
              )
            }
          >
            {busy === 'describe' ? <Spinner size="sm" /> : <Sparkles size={13} />}
            {busy === 'describe' ? 'Writing…' : 'Make it'}
          </Button>
          {busy === 'describe' && <Working what="Writing the page and checking it" slowNote="a model can take a minute" />}
        </div>
      </section>

      <section className="flex items-center gap-3">
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run('import', () => htmlSceneClient.import(projectId))}>
          {busy === 'import' ? <Spinner size="sm" /> : <FolderInput size={13} />}
          Import a page…
        </Button>
        <span className="text-[11px] leading-relaxed text-text-muted">
          An .html file, or a folder with its images and fonts.
        </span>
      </section>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] text-danger">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

type Tab = 'content' | 'look' | 'ai' | 'code'

/**
 * Changing a scene: what it says first, as a form, beside the scene playing. The values and the
 * look reach the preview as they are changed — it used to show only the saved scene, so nothing
 * typed could be seen until it was kept. The code is a tab of its own, for whoever wants it.
 */
function EditHtmlScene({
  projectId,
  item,
  theme,
  warnings,
  onSaved,
  onClose
}: {
  projectId: string
  item: TimelineItem
  theme: RenderTheme | null
  warnings: string[]
  onSaved: (result: HtmlSceneResult) => Promise<void>
  onClose: () => void
}): JSX.Element {
  const data = item.data as HtmlSceneData & { posterUrl?: string }
  const [files, setFiles] = useState<Record<string, string> | null>(null)
  const [changed, setChanged] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState('index.html')
  const [params, setParams] = useState<Record<string, unknown>>(data.params ?? {})
  const [look, setLook] = useState<'brand' | 'light' | 'dark'>(data.style?.theme ?? 'dark')
  const [problems, setProblems] = useState<string[]>(data.check?.problems ?? [])
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState<'save' | 'change' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(Object.keys(data.params ?? {}).length > 0 ? 'content' : 'look')

  useEffect(() => {
    void htmlSceneClient.read(projectId, item.id).then(({ files: read }) => {
      const text = Object.fromEntries(read.flatMap((file) => (file.text === undefined ? [] : [[file.path, file.text]])))
      setFiles(text)
      setOpen(text['index.html'] !== undefined ? 'index.html' : Object.keys(text)[0])
    })
  }, [projectId, item.id])

  const dirty = changed.size > 0 || JSON.stringify(params) !== JSON.stringify(data.params ?? {}) || look !== (data.style?.theme ?? 'dark')

  // The preview plays the scene as it is being changed: its values and look go into the clip it is
  // given, and a page reads its values once as it loads, so a change starts it again — after a
  // pause in typing, not on every key.
  const [shown, setShown] = useState({ params, look })
  // Where the preview is, kept across those restarts so a change is seen at the moment being
  // looked at; it opens 40% in, where a template has everything on screen.
  const playerRef = useRef<PreviewHandle>(null)
  const atFrame = useRef(Math.round(item.duration * 0.4))
  useEffect(() => {
    const timer = setTimeout(() => {
      atFrame.current = playerRef.current?.getCurrentFrame() ?? atFrame.current
      setShown({ params, look })
    }, 450)
    return () => clearTimeout(timer)
  }, [params, look])
  useEffect(() => {
    const frame = requestAnimationFrame(() => playerRef.current?.seekTo(atFrame.current))
    return () => cancelAnimationFrame(frame)
  }, [shown])
  const timeline = useMemo(
    () => [{ ...item, start: 0, data: { ...data, params: shown.params, style: { ...data.style, theme: shown.look } } }] as unknown as CompositionTimelineItem[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, shown]
  )

  async function save(): Promise<void> {
    if (!files) return
    setBusy('save')
    setError(null)
    try {
      const result = await htmlSceneClient.edit(projectId, item.id, {
        files: Object.fromEntries([...changed].map((path) => [path, files[path]])),
        params,
        style: { theme: look }
      })
      setProblems(result.problems)
      setChanged(new Set())
      await onSaved(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function change(): Promise<void> {
    if (!instruction.trim()) return
    setBusy('change')
    setError(null)
    try {
      const result = await htmlSceneClient.change(projectId, item.id, instruction.trim())
      if (result.status === 'failed') {
        setError(result.reason)
        return
      }
      setProblems(result.problems)
      setInstruction('')
      await onSaved(result)
    } finally {
      setBusy(null)
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'content', label: 'Content' },
    { id: 'look', label: 'Look' },
    { id: 'ai', label: 'Ask AI' },
    { id: 'code', label: 'Code' }
  ]

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-104 shrink-0 flex-col border-r border-border">
          <div role="tablist" aria-label="Change the scene" className="flex shrink-0 gap-1 border-b border-border px-3 py-2">
            {TABS.map((choice) => (
              <button
                key={choice.id}
                role="tab"
                type="button"
                aria-selected={tab === choice.id}
                onClick={() => setTab(choice.id)}
                className={cn(
                  'rounded-md border-0 px-3 py-1 text-[12px]',
                  tab === choice.id ? 'bg-accent text-accent-foreground' : 'bg-transparent text-text-muted hover:text-text'
                )}
              >
                {choice.label}
                {choice.id === 'code' && changed.size > 0 ? ' •' : ''}
              </button>
            ))}
          </div>

          {tab === 'content' && (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <ParamsForm params={params} onChange={setParams} />
            </div>
          )}

          {tab === 'look' && (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
              <span className="text-[12px] text-text-muted">Which of the theme&rsquo;s looks this scene is drawn in.</span>
              <div className="flex flex-col gap-2">
                {LOOKS.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    aria-pressed={look === choice.id}
                    onClick={() => setLook(choice.id)}
                    className={cn('rounded-lg border-2 px-3 py-3 text-left text-[13px]', look === choice.id ? 'border-accent' : 'border-border')}
                    style={theme ? { background: theme.variants[choice.id].background, color: theme.variants[choice.id].heading } : undefined}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'ai' && (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
              <span className="text-[12px] text-text-muted">Say what to change. The AI rewrites the page, and Talkie checks it again.</span>
              <Textarea
                aria-label="Change the scene"
                value={instruction}
                placeholder="Make the bars grow one at a time, and add a fifth region"
                onChange={(e) => setInstruction(e.target.value)}
                className="min-h-20 text-[13px]"
              />
              <Button size="sm" className="self-start" disabled={busy !== null || !instruction.trim()} onClick={() => void change()}>
                {busy === 'change' ? <Spinner size="sm" /> : <Sparkles size={13} />}
                {busy === 'change' ? 'Changing…' : 'Change it'}
              </Button>
              {busy === 'change' && <Working what="Rewriting the page and checking it" slowNote="a model can take a minute" />}
            </div>
          )}

          {tab === 'code' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div role="tablist" aria-label="Scene files" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
                {Object.keys(files ?? {}).map((path) => (
                  <button
                    key={path}
                    role="tab"
                    type="button"
                    aria-selected={open === path}
                    onClick={() => setOpen(path)}
                    className={cn(
                      'whitespace-nowrap rounded-md border-0 px-2 py-0.5 text-[11px]',
                      open === path ? 'bg-accent text-accent-foreground' : 'bg-transparent text-text-muted'
                    )}
                  >
                    {path}
                    {changed.has(path) ? ' •' : ''}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1">
                {files ? (
                  <CodePanel
                    path={open}
                    value={files[open] ?? ''}
                    onChange={(text) => {
                      setFiles((all) => ({ ...(all ?? {}), [open]: text }))
                      setChanged((paths) => new Set(paths).add(open))
                    }}
                  />
                ) : (
                  <Spinner size="md" label="Reading the scene" />
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 bg-bg p-4">
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-raised">
            <Preview
              key={JSON.stringify(shown)}
              ref={playerRef}
              component={DemoComposition}
              inputProps={{ timeline, theme }}
              durationInFrames={Math.max(1, item.duration)}
              fps={FPS}
              width={WIDTH}
              height={HEIGHT}
              controls
              loop
              style={{ width: '100%', height: '100%' }}
            />
          </div>
          {changed.size > 0 && <p className="text-[11px] text-text-muted">Code changes show once saved. The content and look are already playing.</p>}
          {[...warnings, ...problems].length > 0 ? (
            <section aria-label="Problems" className="flex flex-col gap-1 overflow-y-auto rounded-xl bg-raised p-3">
              {[...warnings, ...problems].map((problem) => (
                <span key={problem} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-text">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0 text-danger" />
                  {problem}
                </span>
              ))}
            </section>
          ) : (
            <p className="text-[11px] text-text-muted">Checked: it runs, stays in its sandbox, follows the theme and fits the frame.</p>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-border px-5 py-3">
        <span className="text-[11px] text-danger">{error}</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            {dirty ? 'Close without saving' : 'Close'}
          </Button>
          <Button disabled={busy !== null || !dirty} onClick={() => void save()}>
            {busy === 'save' ? <Spinner size="sm" /> : null}
            {busy === 'save' ? 'Saving and checking…' : 'Save scene'}
          </Button>
        </div>
      </footer>
    </>
  )
}

/** "5 min", "1 min 30s", "12s" — the length a description asked for, as a hint in the box. */
function describeSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes === 0) return `${rest}s`
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest}s`
}
