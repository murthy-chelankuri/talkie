# Editor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Editor's bare, unstyled 3-column grid with a resizable/collapsible panel layout, an icon-based toolbar (Import/Export/Record with in-flight status), a drag-and-drop-reorderable timeline clip strip, and a restyled `TranscriptPanel` — all built on the Phase A primitive library and Phase B's conventions, plus one small backend addition (`reorderTimelineItems`) to persist the new clip order.

**Architecture:** `Editor.tsx` is restructured around `react-resizable-panels`' `PanelGroup`/`Panel`/`PanelResizeHandle` for the 3-column layout (Sources, Preview, Transcript), with the Phase A `Panel` UI primitive providing each column's titled header/border treatment. The footer timeline strip becomes a `@dnd-kit` `SortableContext`; dragging a clip calls a new `reorderTimelineItems` main-process function (mirroring every other timeline-mutation function in `projectApi.ts`) through a new `project:timeline:reorder` IPC channel, then reconciles local state from the server's recomputed `start` values. `TranscriptPanel.tsx` gets the same `Card`/`Input`/`Textarea`/`Button`/`ErrorBanner` treatment Phase B gave `ProjectBrowser`, plus one new behavior: a disabled-while-adding guard mirroring the existing disabled-while-narrating guard.

**Tech Stack:** `react-resizable-panels` (resizable/collapsible panel groups), `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (drag-and-drop reordering) — both new. Reuses Phase A's `components/ui/` primitives, `lucide-react`, and the existing Vitest + RTL renderer test setup; reuses the exact `projectApi.ts` write pattern (zod validation + `writeJsonAtomic`) for the new backend function.

**Spec:** `docs/superpowers/specs/2026-09-09-ui-redesign-design.md` (this plan implements §5.4 and §5.5 — Phase C of §9)

## Global Constraints

- Use only the semantic Tailwind color classes from Phase A (`bg`, `surface`, `surface-hover`, `border`, `text`, `text-muted`, `accent`, `accent-hover`, `danger`, `danger-bg`) — never raw palette classes.
- Preserve `Editor`'s external prop signature exactly: `Editor({ projectId }: { projectId: string }): JSX.Element`. Preserve `TranscriptPanel`'s external prop signature exactly: `TranscriptPanel({ projectId, timeline, onTimelineChange }: { projectId: string; timeline: TimelineItem[]; onTimelineChange: () => void | Promise<void> }): JSX.Element`. Neither `App.tsx` nor any caller needs to change.
- **Recording indicator scope decision (explicit, confirmed with the project owner):** the capture pipeline itself is out of scope for this plan (per spec §3/§9), and no signal currently exists for "a real capture session is active" to reach the Editor's window without adding main→renderer IPC push plumbing to the capture pipeline — which would violate that scope boundary. The recording indicator therefore reflects only the in-flight state of the `handleRecordSession` click's own async call (opening the toolbar window), exactly mirroring the existing `exporting` pattern — not the actual duration of the recording session. Do not add any new capture-pipeline IPC channels or events in this plan.
- **Testing scope, per spec §8 exactly:** `reorderTimelineItems` gets a new main-process test (TDD). `TranscriptPanel` gets exactly one new renderer test file, covering its new disabled-while-adding guard (plus enough surrounding coverage to exercise it in context). `Editor.tsx` itself gets **no new automated test file** — resizable-panel and drag-and-drop interactions are spec'd as manually-verified only (both libraries are already well-tested upstream); Editor's toolbar/error-banner wiring is verified by typecheck + a manual run in Task 6, consistent with the spec's testing strategy. Do not add an `Editor.test.tsx` in this plan.
- `reorderTimelineItems` follows the exact validation/write pattern every other mutating function in `src/main/project/projectApi.ts` already uses: parse/validate with the relevant zod schema, throw `err.issues.map(i => i.message).join('; ')` on a `ZodError`, write via `writeJsonAtomic`, default `baseDir: string = homedir()`.
- No comments explaining what code does — only where a non-obvious constraint needs flagging.
- This plan develops directly on `main` (explicit user instruction — no worktree) — commit directly as work progresses.
- Out of scope (per spec §3): any change to the Remotion `<Player>`'s internals, the export pipeline's internals, or the capture/transcript/TTS pipelines' internals beyond the one named exception (`reorderTimelineItems`).

---

## File Structure

```
package.json                                              # modified — new deps

src/main/
  project/
    projectApi.ts                                          # modified — new reorderTimelineItems function
    projectApi.test.ts                                      # modified — new describe block
  ipc/
    timelineHandlers.ts                                      # modified — new project:timeline:reorder channel

src/preload/
  index.ts                                                  # modified — timelineApi.reorder

src/renderer/src/
  api/
    projectClient.ts                                        # modified — timelineClient.reorder
  screens/
    Editor.tsx                                              # modified — full restructure: panels, toolbar, DnD footer
  components/
    TranscriptPanel.tsx                                      # modified — restyled, new disabled-while-adding guard
    TranscriptPanel.test.tsx                                 # new
```

---

### Task 1: Install Phase C dependencies

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `react-resizable-panels` (`Panel`, `PanelGroup`, `PanelResizeHandle`), `@dnd-kit/core` (`DndContext`, `closestCenter`, `PointerSensor`, `useSensor`, `useSensors`, `DragEndEvent`), `@dnd-kit/sortable` (`SortableContext`, `arrayMove`, `horizontalListSortingStrategy`, `useSortable`), `@dnd-kit/utilities` (`CSS`) — available to Task 3 and Task 4. No test file — pure dependency install, verified by a successful build.

- [ ] **Step 1: Install dependencies**

```bash
npm install react-resizable-panels@^4.12.4 @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2
```

- [ ] **Step 2: Verify the install didn't break anything**

```bash
npm run typecheck && npm run build
```

Expected: both exit 0 (nothing imports the new packages yet, so this just confirms the install itself didn't corrupt the dependency tree).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add react-resizable-panels and @dnd-kit dependencies"
```

---

### Task 2: `reorderTimelineItems` backend function + IPC + client wiring

**Files:**
- Modify: `src/main/project/projectApi.ts`
- Modify: `src/main/project/projectApi.test.ts`
- Modify: `src/main/ipc/timelineHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/api/projectClient.ts`

**Interfaces:**
- Consumes: `TimelineItemSchema`, `readTimeline`, `writeJsonAtomic`, `findProjectDir` — all already imported/defined in `projectApi.ts`
- Produces: `reorderTimelineItems(id: string, orderedIds: string[], baseDir?: string): TimelineItem[]`, exposed as IPC channel `project:timeline:reorder`, `window.api.timeline.reorder(id, orderedIds): Promise<TimelineItem[]>`, and `timelineClient.reorder(id, orderedIds): Promise<TimelineItem[]>` — used by Task 4

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `src/main/project/projectApi.test.ts` (alongside the existing `import` list, add `reorderTimelineItems`):

```ts
describe('reorderTimelineItems', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('reorders items and recomputes sequential start values from durations', () => {
    const project = createProject('Reorder', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const b = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)
    const c = addTimelineItem(project.id, { kind: 'image', start: 150, duration: 30, data: { src: '/c.png' } }, baseDir)

    const reordered = reorderTimelineItems(project.id, [c.id, a.id, b.id], baseDir)

    expect(reordered.map((item) => item.id)).toEqual([c.id, a.id, b.id])
    expect(reordered[0].start).toBe(0)
    expect(reordered[1].start).toBe(30)
    expect(reordered[2].start).toBe(120)
  })

  it('preserves each item\'s own duration', () => {
    const project = createProject('Reorder Durations', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const b = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)

    const reordered = reorderTimelineItems(project.id, [b.id, a.id], baseDir)

    expect(reordered.find((item) => item.id === a.id)?.duration).toBe(90)
    expect(reordered.find((item) => item.id === b.id)?.duration).toBe(60)
  })

  it('persists the new order to timeline.json', () => {
    const project = createProject('Reorder Persist', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const b = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)

    reorderTimelineItems(project.id, [b.id, a.id], baseDir)

    expect(readTimeline(project.id, baseDir).map((item) => item.id)).toEqual([b.id, a.id])
  })

  it('throws a clear error when orderedIds is missing an existing item', () => {
    const project = createProject('Reorder Missing', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)

    expect(() => reorderTimelineItems(project.id, [a.id], baseDir)).toThrow(
      `orderedIds must be a permutation of the existing timeline item ids for project ${project.id}`
    )
  })

  it('throws a clear error when orderedIds contains a duplicate', () => {
    const project = createProject('Reorder Duplicate', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const b = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)

    expect(() => reorderTimelineItems(project.id, [a.id, a.id], baseDir)).toThrow(
      `orderedIds must be a permutation of the existing timeline item ids for project ${project.id}`
    )
    void b
  })

  it('throws a clear error when orderedIds contains an unknown id', () => {
    const project = createProject('Reorder Unknown', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)

    expect(() => reorderTimelineItems(project.id, [a.id, 'does-not-exist'], baseDir)).toThrow(
      `orderedIds must be a permutation of the existing timeline item ids for project ${project.id}`
    )
  })
})
```

Also add `reorderTimelineItems` to the `import { ... } from './projectApi'` list at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/main/project/projectApi.test.ts
```

Expected: FAIL — `reorderTimelineItems is not a function` (or a TypeScript error on the import, depending on how the test runner surfaces it).

- [ ] **Step 3: Implement `reorderTimelineItems`**

Add to `src/main/project/projectApi.ts`, after `updateTimelineItemDuration`:

```ts
export function reorderTimelineItems(id: string, orderedIds: string[], baseDir: string = homedir()): TimelineItem[] {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const timeline = readTimeline(id, baseDir)
  const existingIds = new Set(timeline.map((item) => item.id))
  const isPermutation =
    orderedIds.length === timeline.length &&
    new Set(orderedIds).size === orderedIds.length &&
    orderedIds.every((itemId) => existingIds.has(itemId))
  if (!isPermutation) {
    throw new Error(`orderedIds must be a permutation of the existing timeline item ids for project ${id}`)
  }

  const byId = new Map(timeline.map((item) => [item.id, item]))
  let cursor = 0
  const reordered: TimelineItem[] = []
  for (const itemId of orderedIds) {
    const existing = byId.get(itemId) as TimelineItem
    let updated: TimelineItem
    try {
      updated = TimelineItemSchema.parse({ ...existing, start: cursor })
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new Error(err.issues.map((issue) => issue.message).join('; '))
      }
      throw err
    }
    reordered.push(updated)
    cursor += updated.duration
  }

  writeJsonAtomic(join(dir, 'timeline.json'), reordered)
  return reordered
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/main/project/projectApi.test.ts
```

Expected: PASS (all existing `projectApi.test.ts` tests plus the 6 new `reorderTimelineItems` tests).

- [ ] **Step 5: Wire the IPC channel**

In `src/main/ipc/timelineHandlers.ts`, add `reorderTimelineItems` to the import from `'../project/projectApi'`, then add this handler inside `registerTimelineHandlers` (after the `project:timeline:addItem` handler):

```ts
  ipcMain.handle('project:timeline:reorder', (_event, id: string, orderedIds: string[]) =>
    reorderTimelineItems(id, orderedIds)
  )
```

- [ ] **Step 6: Expose it through the preload bridge**

In `src/preload/index.ts`, add to the `timelineApi` object:

```ts
  reorder: (id: string, orderedIds: string[]): Promise<TimelineItem[]> =>
    ipcRenderer.invoke('project:timeline:reorder', id, orderedIds)
```

(`TimelineApi` is `typeof timelineApi`, so its exported type picks this up automatically — no change needed in `src/preload/index.d.ts`.)

- [ ] **Step 7: Expose it through the renderer's `projectClient`**

In `src/renderer/src/api/projectClient.ts`, add to the `timelineClient` object:

```ts
  reorder: (id: string, orderedIds: string[]): Promise<TimelineItem[]> => window.api.timeline.reorder(id, orderedIds)
```

- [ ] **Step 8: Run the full test suite and typecheck**

```bash
npm run test && npm run typecheck
```

Expected: all pass — the IPC/preload/client wiring has no dedicated test (thin passthrough, same as every other IPC channel in this codebase), verified here by typecheck.

- [ ] **Step 9: Commit**

```bash
git add src/main/project/projectApi.ts src/main/project/projectApi.test.ts src/main/ipc/timelineHandlers.ts src/preload/index.ts src/renderer/src/api/projectClient.ts
git commit -m "Add reorderTimelineItems backend function and wire it through IPC"
```

---

### Task 3: Editor — resizable panel layout + icon toolbar

**Files:**
- Modify: `src/renderer/src/screens/Editor.tsx`

**Interfaces:**
- Consumes: `Panel as ResizablePanel, PanelGroup, PanelResizeHandle` from `react-resizable-panels` (Task 1); `Panel` from `../components/ui/Panel`, `Toolbar` from `../components/ui/Toolbar`, `IconButton` from `../components/ui/IconButton`, `Spinner` from `../components/ui/Spinner`, `ErrorBanner` from `../components/ui/ErrorBanner` (Phase A)
- Produces: `Editor({ projectId }: { projectId: string }): JSX.Element` — unchanged external signature. The footer timeline strip in this task is still a static, styled (but non-draggable) row of clips — Task 4 upgrades it to drag-and-drop.

No test file for this task (see Global Constraints — Editor.tsx interaction-heavy restructure is manually verified in Task 6).

- [ ] **Step 1: Replace `Editor.tsx`'s contents**

```tsx
import { useEffect, useState } from 'react'
import { Player } from '@remotion/player'
import { Panel as ResizablePanel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { CircleCheck, Circle, Download, ImagePlus } from 'lucide-react'
import {
  projectClient,
  timelineClient,
  renderClient,
  captureClient,
  type ProjectMetadata,
  type TimelineItem
} from '../api/projectClient'
import { TranscriptPanel } from '../components/TranscriptPanel'
import { Panel } from '../components/ui/Panel'
import { Toolbar } from '../components/ui/Toolbar'
import { IconButton } from '../components/ui/IconButton'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { DemoComposition } from '../../../remotion/DemoComposition'
import { FPS, WIDTH, HEIGHT } from '../../../remotion/constants'
import { computeTimelineDuration } from '../../../remotion/timelineDuration'
import type { TimelineItem as RemotionTimelineItem } from '../../../remotion/types'

export function Editor({ projectId }: { projectId: string }): JSX.Element {
  const [project, setProject] = useState<ProjectMetadata | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([projectClient.open(projectId), timelineClient.read(projectId)])
      .then(([openedProject, items]) => {
        setProject(openedProject)
        setTimeline(items)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [projectId])

  async function refreshTimeline(): Promise<void> {
    setTimeline(await timelineClient.read(projectId))
  }

  async function handleImportImage(): Promise<void> {
    setImportError(null)
    try {
      const item = await projectClient.importImage(projectId)
      if (item) {
        await refreshTimeline()
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleExport(): Promise<void> {
    setExporting(true)
    setExportError(null)
    setExportedPath(null)
    try {
      const path = await renderClient.exportVideo(projectId)
      setExportedPath(path)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  async function handleRecordSession(): Promise<void> {
    setRecordError(null)
    setRecording(true)
    try {
      await captureClient.openToolbar(projectId)
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : String(err))
    } finally {
      setRecording(false)
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorBanner message={error} />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="md" label="Loading project" />
      </div>
    )
  }

  // Cast: schema.ts's zod-inferred TimelineItem treats `data` as optional (z.unknown() accepts
  // undefined), while remotion/types.ts's hand-written TimelineItem requires it. Both describe
  // the same real shape validated by TimelineItemSchema.superRefine, so the optionality is a
  // static-typing artifact, not a runtime possibility. Same workaround as renderProject.ts /
  // timelineHandlers.ts.
  const remotionTimeline = timeline as unknown as RemotionTimelineItem[]

  return (
    <div className="flex h-full flex-col">
      <PanelGroup direction="horizontal" autoSaveId="editor-layout" className="min-h-0 flex-1">
        <ResizablePanel id="sources" collapsible defaultSize={20} minSize={12}>
          <Panel title="Sources & Agents" className="h-full">
            <Toolbar className="border-0 bg-transparent p-0">
              <IconButton aria-label="Import Image" onClick={handleImportImage}>
                <ImagePlus size={16} />
              </IconButton>
              <IconButton
                aria-label={exporting ? 'Exporting video' : 'Export video'}
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? <Spinner size="sm" /> : <Download size={16} />}
              </IconButton>
              <IconButton
                aria-label={recording ? 'Recording in progress' : 'Record session'}
                onClick={handleRecordSession}
                disabled={recording}
              >
                {recording ? <Spinner size="sm" /> : <Circle size={16} />}
              </IconButton>
            </Toolbar>
            {recording && (
              <span className="mt-2 flex items-center gap-1.5 text-xs text-danger">
                <span className="h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden="true" />
                Recording…
              </span>
            )}
            {exportedPath && (
              <span className="mt-2 flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1 text-xs text-text-muted">
                <CircleCheck size={14} className="text-accent" aria-hidden="true" />
                Exported to {exportedPath}
              </span>
            )}
            <div className="mt-2 flex flex-col gap-2">
              {importError && <ErrorBanner message={importError} />}
              {exportError && <ErrorBanner message={exportError} />}
              {recordError && <ErrorBanner message={recordError} />}
            </div>
          </Panel>
        </ResizablePanel>
        <PanelResizeHandle className="w-1 bg-border transition-colors hover:bg-accent" />
        <ResizablePanel id="preview" defaultSize={55} minSize={30}>
          <div className="flex h-full items-center justify-center bg-bg p-4">
            {timeline.length > 0 ? (
              <Player
                component={DemoComposition}
                inputProps={{ timeline: remotionTimeline }}
                durationInFrames={computeTimelineDuration(remotionTimeline)}
                fps={FPS}
                compositionWidth={WIDTH}
                compositionHeight={HEIGHT}
                style={{ width: '100%', height: '100%' }}
                controls
              />
            ) : (
              <p className="text-sm text-text-muted">Preview — {project.name}</p>
            )}
          </div>
        </ResizablePanel>
        <PanelResizeHandle className="w-1 bg-border transition-colors hover:bg-accent" />
        <ResizablePanel id="transcript" collapsible defaultSize={25} minSize={15}>
          <Panel title="Transcript" className="h-full">
            <TranscriptPanel projectId={projectId} timeline={timeline} onTimelineChange={refreshTimeline} />
          </Panel>
        </ResizablePanel>
      </PanelGroup>
      <footer className="flex h-40 items-center gap-2 overflow-x-auto border-t border-border bg-surface p-2">
        {timeline.map((item) => (
          <div
            key={item.id}
            className="flex h-full w-32 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-sm text-text"
          >
            {item.kind}
          </div>
        ))}
      </footer>
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: exit 0. If `react-resizable-panels`' types don't match (e.g. a renamed prop), fix here before continuing — this is the fail-fast checkpoint for that dependency's API.

- [ ] **Step 3: Run the full test suite** (confirms this restructure didn't break `TranscriptPanel`'s pre-existing behavior, still used unchanged here)

```bash
npm run test
```

Expected: PASS — same test count as after Task 2 (no new tests added in this task).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/screens/Editor.tsx
git commit -m "Rebuild Editor around resizable panels and an icon toolbar"
```

---

### Task 4: Drag-and-drop timeline clip reordering

**Files:**
- Modify: `src/renderer/src/screens/Editor.tsx`

**Interfaces:**
- Consumes: `DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent` from `@dnd-kit/core`; `SortableContext, arrayMove, horizontalListSortingStrategy, useSortable` from `@dnd-kit/sortable`; `CSS` from `@dnd-kit/utilities` (Task 1); `timelineClient.reorder` (Task 2)
- Produces: draggable/reorderable footer clips; no external interface change

No test file for this task (see Global Constraints — drag-and-drop is manually verified in Task 6).

- [ ] **Step 1: Add the DnD imports**

At the top of `src/renderer/src/screens/Editor.tsx`, add:

```tsx
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
```

- [ ] **Step 2: Add reorder state, the drag sensor, and the drag handler**

Inside the `Editor` function, alongside the other `useState` calls, add:

```tsx
  const [reorderError, setReorderError] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
```

Add this function alongside the other handlers (e.g. after `refreshTimeline`):

```tsx
  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = timeline.findIndex((item) => item.id === active.id)
    const newIndex = timeline.findIndex((item) => item.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(timeline, oldIndex, newIndex)
    setTimeline(reordered)
    setReorderError(null)
    try {
      const updated = await timelineClient.reorder(
        projectId,
        reordered.map((item) => item.id)
      )
      setTimeline(updated)
    } catch (err) {
      setReorderError(err instanceof Error ? err.message : String(err))
      await refreshTimeline()
    }
  }
```

- [ ] **Step 3: Add the `TimelineClip` sortable item component**

Below the `Editor` function (module scope), add:

```tsx
function TimelineClip({ item }: { item: TimelineItem }): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      {...attributes}
      {...listeners}
      className="flex h-full w-32 shrink-0 cursor-grab items-center justify-center rounded-md border border-border bg-bg text-sm text-text active:cursor-grabbing"
    >
      {item.kind}
    </div>
  )
}
```

- [ ] **Step 4: Replace the footer with the sortable version**

Replace the `<footer>...</footer>` block from Task 3 with:

```tsx
      <footer className="flex h-40 flex-col gap-1 border-t border-border bg-surface p-2">
        {reorderError && <ErrorBanner message={reorderError} />}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={timeline.map((item) => item.id)} strategy={horizontalListSortingStrategy}>
            <div className="flex flex-1 items-center gap-2 overflow-x-auto">
              {timeline.map((item) => (
                <TimelineClip key={item.id} item={item} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </footer>
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Run the full test suite**

```bash
npm run test
```

Expected: PASS — unchanged test count.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/screens/Editor.tsx
git commit -m "Add drag-and-drop timeline clip reordering"
```

---

### Task 5: Restyle `TranscriptPanel` + disabled-while-adding guard

**Files:**
- Modify: `src/renderer/src/components/TranscriptPanel.tsx`
- Test: `src/renderer/src/components/TranscriptPanel.test.tsx`

**Interfaces:**
- Consumes: `Card` from `./ui/Card`, `Textarea` from `./ui/Textarea`, `Button` from `./ui/Button`, `IconButton` from `./ui/IconButton`, `Spinner` from `./ui/Spinner`, `ErrorBanner` from `./ui/ErrorBanner` (Phase A); `transcriptClient` from `../api/projectClient` (unchanged)
- Produces: `TranscriptPanel({ projectId, timeline, onTimelineChange }): JSX.Element` — unchanged external signature, consumed by `Editor.tsx` (Task 3, no change needed there)

- [ ] **Step 1: Write the failing tests**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranscriptPanel } from './TranscriptPanel'
import { transcriptClient, type TimelineItem, type TranscriptSegment } from '../api/projectClient'

vi.mock('../api/projectClient', () => ({
  transcriptClient: {
    read: vi.fn(),
    addSegment: vi.fn(),
    updateText: vi.fn(),
    narrate: vi.fn()
  }
}))

const mockedRead = vi.mocked(transcriptClient.read)
const mockedAddSegment = vi.mocked(transcriptClient.addSegment)
const mockedNarrate = vi.mocked(transcriptClient.narrate)

const timeline: TimelineItem[] = [{ id: 'item-1', kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }]

describe('TranscriptPanel', () => {
  beforeEach(() => {
    mockedRead.mockReset()
    mockedAddSegment.mockReset()
    mockedNarrate.mockReset()
    mockedRead.mockResolvedValue([])
  })

  it('disables Add Segment while the form is blank', async () => {
    render(<TranscriptPanel projectId="p1" timeline={timeline} onTimelineChange={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Add Segment' })).toBeDisabled()
  })

  it('disables Add Segment while a submission is in flight', async () => {
    const user = userEvent.setup()
    let resolveAdd: ((segment: TranscriptSegment) => void) | undefined
    mockedAddSegment.mockReturnValue(new Promise((resolve) => (resolveAdd = resolve)))

    render(<TranscriptPanel projectId="p1" timeline={timeline} onTimelineChange={vi.fn()} />)

    await user.selectOptions(await screen.findByRole('combobox'), 'item-1')
    await user.type(screen.getByPlaceholderText('New segment text'), 'Hello')
    await user.click(screen.getByRole('button', { name: 'Add Segment' }))

    expect(screen.getByRole('button', { name: 'Add Segment' })).toBeDisabled()

    resolveAdd?.({ id: 's1', text: 'Hello', timelineItemId: 'item-1', status: 'edited' })
    await waitFor(() => expect(mockedAddSegment).toHaveBeenCalledTimes(1))
  })

  it('disables the Narrate button for a segment while it is narrating', async () => {
    const user = userEvent.setup()
    mockedRead.mockResolvedValue([{ id: 's1', text: 'Hi', timelineItemId: 'item-1', status: 'edited' }])
    let resolveNarrate: ((segment: TranscriptSegment) => void) | undefined
    mockedNarrate.mockReturnValue(new Promise((resolve) => (resolveNarrate = resolve)))

    render(<TranscriptPanel projectId="p1" timeline={timeline} onTimelineChange={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Narrate' }))
    expect(screen.getByRole('button', { name: 'Narrating' })).toBeDisabled()

    resolveNarrate?.({ id: 's1', text: 'Hi', timelineItemId: 'item-1', status: 'narrated', audioFile: '/a.wav' })
    await waitFor(() => expect(mockedNarrate).toHaveBeenCalledTimes(1))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/renderer/src/components/TranscriptPanel.test.tsx
```

Expected: FAIL — current markup has no accessible "Add Segment"/"Narrate" button roles matching these queries reliably, and there is no disabled-while-adding guard yet.

- [ ] **Step 3: Write the implementation**

```tsx
import { useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import { transcriptClient, type TranscriptSegment, type TimelineItem } from '../api/projectClient'
import { Card } from './ui/Card'
import { Textarea } from './ui/Textarea'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Spinner } from './ui/Spinner'
import { ErrorBanner } from './ui/ErrorBanner'

export function TranscriptPanel({
  projectId,
  timeline,
  onTimelineChange
}: {
  projectId: string
  timeline: TimelineItem[]
  onTimelineChange: () => void | Promise<void>
}): JSX.Element {
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [newText, setNewText] = useState('')
  const [newItemId, setNewItemId] = useState('')
  const [narratingId, setNarratingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    transcriptClient.read(projectId).then(setSegments)
  }, [projectId])

  async function handleAdd(): Promise<void> {
    if (!newText.trim() || !newItemId) return
    setError(null)
    setAdding(true)
    try {
      await transcriptClient.addSegment(projectId, { text: newText.trim(), timelineItemId: newItemId })
      setNewText('')
      setSegments(await transcriptClient.read(projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  function handleLocalTextChange(segmentId: string, text: string): void {
    setSegments((prev) => prev.map((s) => (s.id === segmentId ? { ...s, text } : s)))
  }

  async function handleTextBlur(segmentId: string, text: string): Promise<void> {
    setError(null)
    try {
      await transcriptClient.updateText(projectId, segmentId, text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleNarrate(segmentId: string): Promise<void> {
    setNarratingId(segmentId)
    setError(null)
    try {
      const updated = await transcriptClient.narrate(projectId, segmentId)
      setSegments((prev) => prev.map((s) => (s.id === segmentId ? updated : s)))
      await onTimelineChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setNarratingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} />}
      {segments.map((segment) => (
        <Card key={segment.id} className="flex flex-col gap-2">
          <Textarea
            value={segment.text}
            onChange={(e) => handleLocalTextChange(segment.id, e.target.value)}
            onBlur={(e) => handleTextBlur(segment.id, e.target.value)}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">{segment.status}</span>
            <IconButton
              aria-label={narratingId === segment.id ? 'Narrating' : 'Narrate'}
              onClick={() => handleNarrate(segment.id)}
              disabled={narratingId === segment.id}
            >
              {narratingId === segment.id ? <Spinner size="sm" /> : <Mic size={16} />}
            </IconButton>
          </div>
        </Card>
      ))}
      <Card className="flex flex-col gap-2">
        <select
          value={newItemId}
          onChange={(e) => setNewItemId(e.target.value)}
          disabled={adding}
          className="h-9 rounded-md border border-border bg-bg px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
        >
          <option value="">Select timeline item…</option>
          {timeline.map((item) => (
            <option key={item.id} value={item.id}>
              {item.kind} ({item.id.slice(0, 8)})
            </option>
          ))}
        </select>
        <Textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="New segment text"
          disabled={adding}
        />
        <Button onClick={handleAdd} disabled={adding || !newText.trim() || !newItemId}>
          {adding ? <Spinner size="sm" /> : 'Add Segment'}
        </Button>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/renderer/src/components/TranscriptPanel.test.tsx
```

Expected: PASS (3 tests)

- [ ] **Step 5: Run the full test suite**

```bash
npm run test
```

Expected: PASS — all existing tests plus the 3 new `TranscriptPanel.test.tsx` tests.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/TranscriptPanel.tsx src/renderer/src/components/TranscriptPanel.test.tsx
git commit -m "Restyle TranscriptPanel and add a disabled-while-adding guard"
```

---

### Task 6: Full plan verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

```bash
npm run test
```

Expected: PASS — all existing tests plus the 6 new `reorderTimelineItems` tests and 3 new `TranscriptPanel` tests from this plan.

- [ ] **Step 2: Run the full typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 3: Manually verify in the running app**

```bash
npm run dev
```

In the running window, open a project with at least 2-3 timeline items (import a couple of images if needed) and confirm:
- The Editor shows three resizable columns (Sources & Agents / Preview / Transcript) with drag handles between them — drag a handle and confirm the columns resize; drag the Sources or Transcript handle past its collapse threshold and confirm that column collapses.
- The Sources toolbar shows Import/Export/Record icon buttons; click Import Image and confirm it still imports; click Export Video and confirm a spinner shows on the button during export, then a small "Exported to …" confirmation appears; click Record Session and confirm the toolbar window still opens (the pulsing "Recording…" indicator will flash briefly — expected, per the Global Constraints scope decision).
- The footer timeline strip shows each clip as a draggable tile; drag one clip to a new position and confirm it visually reorders and stays reordered after the drop (i.e. the reorder persisted) — reload the project (close and reopen it) and confirm the new order survived.
- The Transcript panel shows each segment as a card with a Narrate icon button, and the "Add Segment" form at the bottom; confirm adding a segment still works and the Add button visibly disables while its request is in flight.
- Toggle the theme and confirm the whole Editor (panels, toolbar, footer clips, transcript cards) re-colors correctly in both light and dark.

- [ ] **Step 4: Clean up**

Stop the dev server (Ctrl+C).

- [ ] **Step 5: Final commit** (only if any of the above required fixes)

```bash
git add -A
git commit -m "Fix issues found in Editor redesign verification"
```

If nothing needed fixing, there is nothing to commit — this plan is complete, and the full UI redesign (Phases A, B, C) is done.
