import { useEffect, useMemo, useState } from 'react'
import { Player } from '@remotion/player'
import { FolderInput, LayoutTemplate, Sparkles, TriangleAlert } from 'lucide-react'
import {
  htmlSceneClient,
  timelineClient,
  type HtmlSceneData,
  type HtmlSceneResult,
  type TimelineItem
} from '../../api/projectClient'
import type { RenderTheme } from '../../../../remotion/renderTheme'
import type { TimelineItem as RemotionTimelineItem } from '../../../../remotion/types'
import { DemoComposition } from '../../../../remotion/DemoComposition'
import { FPS, HEIGHT, WIDTH } from '../../../../remotion/constants'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { Spinner } from '../ui/Spinner'
import { cn } from '../../lib/cn'
import { CodePanel } from './CodePanel'
import { ParamsForm } from './ParamsForm'

const LOOKS = [
  { id: 'brand', label: 'Brand' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
] as const

/**
 * An HTML scene in the scene dialog: three ways to start one, then its code, its values and its
 * look beside the scene playing as the video will play it.
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

function StartHtmlScene({ projectId, onCreated }: { projectId: string; onCreated: (result: HtmlSceneResult) => Promise<void> }): JSX.Element {
  const [description, setDescription] = useState('')
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string }[]>([])
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <section className="flex flex-col gap-2 rounded-lg bg-raised p-4">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-text">
          <Sparkles size={14} className="text-accent" /> Describe it
        </span>
        <span className="text-[11px] leading-relaxed text-text-muted">
          Your AI model writes the page, in this project&rsquo;s theme and timed to its narration. Talkie checks it before it reaches the timeline.
        </span>
        <Textarea
          aria-label="Describe the scene"
          value={description}
          placeholder="An animated bar chart of Q3 revenue by region; each bar grows as its region is mentioned"
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[4.5rem] text-[13px]"
        />
        <Button
          size="sm"
          className="self-start"
          disabled={busy !== null || !description.trim()}
          onClick={() => void run('describe', () => htmlSceneClient.describe(projectId, description.trim()))}
        >
          {busy === 'describe' ? <Spinner size="sm" /> : <Sparkles size={13} />}
          {busy === 'describe' ? 'Writing and checking…' : 'Make it'}
        </Button>
      </section>

      <section className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-text">
          <LayoutTemplate size={14} className="text-accent" /> Start from a template
        </span>
        <div className="grid grid-cols-3 gap-2">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void run(template.id, () => htmlSceneClient.fromTemplate(projectId, template.id, template.name))}
              className="flex flex-col gap-1 rounded-lg bg-raised p-3 text-left transition-colors hover:border-text-muted/40 disabled:opacity-60"
            >
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-text">
                {busy === template.id && <Spinner size="sm" />}
                {template.name}
              </span>
              <span className="text-[11px] leading-snug text-text-muted">{template.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-text">
          <FolderInput size={14} className="text-accent" /> Import a page
        </span>
        <span className="text-[11px] leading-relaxed text-text-muted">
          An .html file, or a folder with its images and fonts. Anything it loads from the internet is named, since a scene cannot.
        </span>
        <Button size="sm" variant="ghost" className="self-start" disabled={busy !== null} onClick={() => void run('import', () => htmlSceneClient.import(projectId))}>
          {busy === 'import' ? <Spinner size="sm" /> : <FolderInput size={13} />}
          Choose a file or folder…
        </Button>
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

  useEffect(() => {
    void htmlSceneClient.read(projectId, item.id).then(({ files: read }) => {
      const text = Object.fromEntries(read.flatMap((file) => (file.text === undefined ? [] : [[file.path, file.text]])))
      setFiles(text)
      setOpen(text['index.html'] !== undefined ? 'index.html' : Object.keys(text)[0])
    })
  }, [projectId, item.id])

  const dirty = changed.size > 0 || JSON.stringify(params) !== JSON.stringify(data.params ?? {}) || look !== (data.style?.theme ?? 'dark')
  const timeline = useMemo(() => [{ ...item, start: 0 }] as unknown as RemotionTimelineItem[], [item])

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

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[26rem] shrink-0 flex-col border-r border-border">
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
          <div className="flex max-h-[45%] shrink-0 flex-col gap-3 overflow-y-auto border-t border-border p-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-text">Look</span>
              <div className="flex gap-1.5">
                {LOOKS.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    aria-pressed={look === choice.id}
                    onClick={() => setLook(choice.id)}
                    className={cn(
                      'flex-1 rounded-md border px-2 py-1 text-[11px]',
                      look === choice.id ? 'border-accent text-text' : 'border-border text-text-muted'
                    )}
                    style={theme ? { background: theme.variants[choice.id].background, color: theme.variants[choice.id].heading } : undefined}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-text">Values</span>
              <ParamsForm params={params} onChange={setParams} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-text">Change with AI</span>
              <Textarea
                aria-label="Change the scene"
                value={instruction}
                placeholder="Make the bars grow one at a time"
                onChange={(e) => setInstruction(e.target.value)}
                className="min-h-[3.5rem] text-[12px]"
              />
              <Button size="sm" className="self-start" disabled={busy !== null || !instruction.trim()} onClick={() => void change()}>
                {busy === 'change' ? <Spinner size="sm" /> : <Sparkles size={13} />}
                {busy === 'change' ? 'Changing and checking…' : 'Change it'}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 bg-bg p-4">
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-raised">
            <Player
              component={DemoComposition}
              inputProps={{ timeline, theme }}
              durationInFrames={Math.max(1, item.duration)}
              fps={FPS}
              compositionWidth={WIDTH}
              compositionHeight={HEIGHT}
              controls
              loop
              style={{ width: '100%', height: '100%' }}
            />
          </div>
          {dirty && <p className="text-[11px] text-text-muted">The preview shows the saved scene. Save to see your changes play.</p>}
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
            Close
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
