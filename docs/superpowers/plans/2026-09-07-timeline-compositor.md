# Timeline & Compositor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a project a real timeline data model and a working Remotion compositor — an `image` timeline item that can be imported, previewed live in the Editor, and exported to a real MP4 — proving the full "content on screen" pipeline end to end.

**Architecture:** `timeline.json` (introduced as an empty array in Plan 1) becomes a real array of validated `TimelineItem`s. A `src/remotion/` module (shared between the Electron renderer and Node's main process) defines one Remotion composition driven entirely by that array; `@remotion/player` renders it live inside the Editor, and `@remotion/renderer` renders the identical composition headlessly to an MP4 file. Both paths read the same `timeline.json` and share the same React components — this is what the spec calls "no drift between what the user sees while editing and what gets exported."

**Tech Stack:** Remotion (`remotion`, `@remotion/player`, `@remotion/bundler`, `@remotion/renderer`), on top of Plan 1's Electron + React + TypeScript + Vitest + Zod foundation.

**Spec:** `docs/superpowers/specs/2026-09-06-demo-editor-design.md`

## Global Constraints

- `timeline.json` is the single source of truth for both the live editor and the exported video (spec §3, §4) — no separate "preview data" and "export data."
- Every registered `TimelineItem.kind` supplies a Zod schema (validates + will later drive a generated property panel) and a Remotion component (spec §4). This plan implements both halves for the `image` kind only.
- Rendering — both live preview and final export — goes through Remotion (spec §3).
- All writes to project files are atomic; `baseDir` is threaded through every project-path/API function so tests never touch the real home directory (carried from Plan 1's Global Constraints).
- A project is files only — no embedded database (spec §2, §4).
- macOS only for v1 (spec §1).
- No comments explaining *what* code does — only where a non-obvious constraint needs flagging.
- This execution environment is headless (no display). Confirmed during Plan 1: `npm run dev` starts the Electron process but no window renders. Any task step that would normally require a human to click through a visible window instead uses a temporary (reverted before commit) `webContents.executeJavaScript` block driving the real DOM via simulated native input events — see Task 8 for the concrete pattern. Remotion's own renderer (`@remotion/renderer`) manages its own headless Chromium independent of Electron's display, so composition/export tests (Tasks 4-5) are genuinely, fully automated — no workaround needed there.

---

## Plan sequence context

This is **Plan 2 of the overall spec** (Plan 1: project foundation, merged to `main`). It deliberately narrows the spec's full timeline/compositor vision to the smallest slice that proves the pipeline end to end. Explicitly **out of scope for this plan** (each is a disclosed, deliberate cut, not an oversight):

- **PPT import.** The spec's LibreOffice-based slide-to-PNG pipeline (§6) is a substantial external-dependency integration in its own right — it gets its own plan once this one's `TimelineItem`/import pattern exists to build on.
- **Drag-to-move, drag-to-trim, and click-to-select on the timeline strip.** The bottom timeline region in this plan is read-only — colored blocks sized by duration, no interaction. Interactive editing is deferred until there's a second item kind to design the generic interaction model against.
- **Generic Zod-schema-to-property-panel form generation** (spec §4/§5). With only one kind (`image`, which has a single `src` field), generalizing the schema→form mapping now would be speculative. Deferred until a second kind exists.
- **A formal, swappable `Compositor` interface** (spec §3's `renderFrameRange`/`renderToFile`). Only one compositor implementation (Remotion) exists and nothing else calls it yet — introducing the interface now would be an abstraction with a single implementation and no real caller to prove it against. `renderProjectVideo` is a plain function; formalize the interface if/when a second backend or a concrete driver (e.g. a licensing-driven swap) requires it.
- **Packaging-safe compositor entry-point resolution.** `renderProjectVideo` resolves its Remotion bundle entry point relative to `process.cwd()`, which is correct when running via `npm run dev`/`npm start` (this plan's entire execution and test context) but not yet safe inside a packaged/asar'd app. Packaging is unaddressed by any plan so far — Plan 1 didn't touch it either.
- **Configurable resolution/frame rate.** Hardcoded to 1920×1080 @ 30fps as the v1 default (`src/remotion/constants.ts`). Spec doesn't mandate otherwise yet.

---

## File Structure

```
package.json                                    # + 4 Remotion packages
src/
  remotion/                                      # shared by the Vite-bundled renderer AND the
                                                  # separately-webpack-bundled Remotion export pipeline —
                                                  # plain React/TS, no Electron-specific globals allowed here
    constants.ts                                 # FPS, WIDTH, HEIGHT
    types.ts                                     # TimelineItem (plain TS shape, no Zod — that's main-side)
    timelineDuration.ts                          # computeTimelineDuration()
    timelineDuration.test.ts
    items/
      ImageItem.tsx                              # renders one 'image'-kind item
    itemRegistry.tsx                             # kind -> Component map
    DemoComposition.tsx                          # iterates timeline, wraps each item in <Sequence>
    index.ts                                     # registerRoot() entry point for @remotion/bundler
  main/
    project/
      timeline/
        schema.ts                                # TimelineItemSchema, TIMELINE_ITEM_DATA_SCHEMAS, ImageItemDataSchema
        schema.test.ts
      projectApi.ts                               # + readTimeline, addTimelineItem, importImage
      projectApi.test.ts                          # + tests for the three new functions
    render/
      renderProject.ts                            # bundle + selectComposition + renderMedia -> MP4
      renderProject.test.ts
    ipc/
      timelineHandlers.ts                         # project:timeline:read/addItem, project:render:export, project:import:image
  preload/
    index.ts                                      # + timeline/render namespaces, project.importImage
    index.d.ts                                     # + matching types
  renderer/src/
    api/
      projectClient.ts                             # + timeline/render/importImage wrappers
    screens/
      Editor.tsx                                   # + Player-or-placeholder, timeline strip, Import Image button
```

---

### Task 1: Install Remotion packages

**Files:**
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: nothing
- Produces: `remotion`, `@remotion/player`, `@remotion/bundler`, `@remotion/renderer` installed at one mutually-consistent version — every later task in this plan imports from these

Remotion requires all `@remotion/*` packages to be the exact same version as `remotion` itself. Installing all four via `@latest` in one command guarantees npm resolves them together, rather than hand-picking a version number that might not exist or might mismatch by the time this plan is executed.

- [ ] **Step 1: Install at matching latest versions**

Run: `npm install remotion@latest @remotion/player@latest @remotion/bundler@latest @remotion/renderer@latest`

- [ ] **Step 2: Verify version parity**

Run: `node -e "const p = require('./package.json'); console.log(p.dependencies.remotion, p.dependencies['@remotion/player'], p.dependencies['@remotion/bundler'], p.dependencies['@remotion/renderer'])"`
Expected: all four print the identical version number (e.g. all `^4.x.y` with the same `x.y`). If they don't match, stop and report — do not proceed with mismatched versions.

- [ ] **Step 3: Verify the install didn't break the existing build**

Run: `npm run typecheck`
Expected: exits 0 (Remotion packages aren't imported anywhere yet, so this should be unaffected — this step just confirms the install itself didn't corrupt `node_modules` or `package-lock.json`)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "Install Remotion packages"
```

---

### Task 2: Timeline item schema & registry

**Files:**
- Create: `src/main/project/timeline/schema.ts`
- Test: `src/main/project/timeline/schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `ImageItemDataSchema: ZodSchema` (`{ src: string }`)
  - `TIMELINE_ITEM_DATA_SCHEMAS: Record<string, ZodSchema>` (currently `{ image: ImageItemDataSchema }`)
  - `TimelineItemSchema: ZodSchema` (envelope: `id`, `kind`, `start`, `duration`, `data`, cross-validates `data` against `TIMELINE_ITEM_DATA_SCHEMAS[kind]`)
  - `type TimelineItem = z.infer<typeof TimelineItemSchema>`
  - Used by Task 3 (`projectApi.ts`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { TimelineItemSchema } from './schema'

describe('TimelineItemSchema', () => {
  it('accepts a valid image item', () => {
    const item = {
      id: 'abc123',
      kind: 'image',
      start: 0,
      duration: 90,
      data: { src: '/tmp/photo.png' }
    }

    expect(TimelineItemSchema.parse(item)).toEqual(item)
  })

  it('rejects an unknown kind', () => {
    const item = { id: 'abc123', kind: 'nonexistent-kind', start: 0, duration: 90, data: {} }

    expect(() => TimelineItemSchema.parse(item)).toThrow(/Unknown timeline item kind/)
  })

  it('rejects image data missing src', () => {
    const item = { id: 'abc123', kind: 'image', start: 0, duration: 90, data: {} }

    expect(() => TimelineItemSchema.parse(item)).toThrow(/Invalid data for kind "image"/)
  })

  it('rejects a negative start', () => {
    const item = { id: 'abc123', kind: 'image', start: -1, duration: 90, data: { src: '/tmp/photo.png' } }

    expect(() => TimelineItemSchema.parse(item)).toThrow()
  })

  it('rejects a zero or negative duration', () => {
    const item = { id: 'abc123', kind: 'image', start: 0, duration: 0, data: { src: '/tmp/photo.png' } }

    expect(() => TimelineItemSchema.parse(item)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/project/timeline/schema.test.ts`
Expected: FAIL — `Cannot find module './schema'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from 'zod'

export const ImageItemDataSchema = z.object({
  src: z.string()
})

export const TIMELINE_ITEM_DATA_SCHEMAS: Record<string, z.ZodSchema> = {
  image: ImageItemDataSchema
}

export const TimelineItemSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    start: z.number().int().min(0),
    duration: z.number().int().min(1),
    data: z.unknown()
  })
  .superRefine((item, ctx) => {
    const dataSchema = TIMELINE_ITEM_DATA_SCHEMAS[item.kind]
    if (!dataSchema) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kind'], message: `Unknown timeline item kind "${item.kind}"` })
      return
    }
    const result = dataSchema.safeParse(item.data)
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['data'],
        message: `Invalid data for kind "${item.kind}": ${result.error.message}`
      })
    }
  })

export type TimelineItem = z.infer<typeof TimelineItemSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/project/timeline/schema.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/project/timeline/schema.ts src/main/project/timeline/schema.test.ts
git commit -m "Add timeline item schema and kind registry"
```

---

### Task 3: `readTimeline` and `addTimelineItem`

**Files:**
- Modify: `src/main/project/projectApi.ts`
- Modify: `src/main/project/projectApi.test.ts`

**Interfaces:**
- Consumes: `TimelineItemSchema`, `type TimelineItem` (Task 2), `findProjectDir` (Plan 1), `writeJsonAtomic` (Plan 1)
- Produces:
  - `readTimeline(id: string, baseDir?: string): TimelineItem[]`
  - `addTimelineItem(id: string, item: { kind: string; start: number; duration: number; data: unknown }, baseDir?: string): TimelineItem`
  - Used by Task 4's smoke test, Task 5 (`renderProject.ts`), Task 6 (`importImage`), Task 7 (IPC handlers)

- [ ] **Step 1: Write the failing test**

Append to `src/main/project/projectApi.test.ts` (fold `readTimeline`/`addTimelineItem` into the existing `import { createProject, listProjects, openProject } from './projectApi'` line rather than adding a second import statement):

```ts
describe('readTimeline', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('returns an empty array for a freshly created project', () => {
    const project = createProject('Empty Timeline', baseDir)

    expect(readTimeline(project.id, baseDir)).toEqual([])
  })

  it('throws when the project does not exist', () => {
    expect(() => readTimeline('does-not-exist', baseDir)).toThrow('No project found with id does-not-exist')
  })
})

describe('addTimelineItem', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('appends a validated item and returns it with a generated id', () => {
    const project = createProject('Add Item', baseDir)

    const added = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)

    expect(added.id).toBeTruthy()
    expect(added.kind).toBe('image')
    expect(readTimeline(project.id, baseDir)).toEqual([added])
  })

  it('appends a second item after the first without overwriting it', () => {
    const project = createProject('Add Two Items', baseDir)

    const first = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)
    const second = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/tmp/b.png' } }, baseDir)

    expect(readTimeline(project.id, baseDir)).toEqual([first, second])
  })

  it('rejects invalid item data and writes nothing', () => {
    const project = createProject('Reject Invalid', baseDir)

    expect(() => addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: {} }, baseDir)).toThrow(
      /Invalid data for kind "image"/
    )
    expect(readTimeline(project.id, baseDir)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/project/projectApi.test.ts`
Expected: FAIL — `readTimeline is not a function`

- [ ] **Step 3: Write the implementation**

Add to `src/main/project/projectApi.ts` (add `randomUUID` is already imported from Task 1's plan via `crypto` — reuse it; add `TimelineItemSchema, type TimelineItem` to a new import from `./timeline/schema`):

```ts
import { TimelineItemSchema, type TimelineItem } from './timeline/schema'

export function readTimeline(id: string, baseDir: string = homedir()): TimelineItem[] {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const raw = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf-8'))
  return raw.map((item: unknown) => TimelineItemSchema.parse(item))
}

export function addTimelineItem(
  id: string,
  item: { kind: string; start: number; duration: number; data: unknown },
  baseDir: string = homedir()
): TimelineItem {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const newItem = TimelineItemSchema.parse({ id: randomUUID(), ...item })
  const timeline = readTimeline(id, baseDir)
  timeline.push(newItem)
  writeJsonAtomic(join(dir, 'timeline.json'), timeline)
  return newItem
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/project/projectApi.test.ts`
Expected: PASS (all tests including the 5 new ones)

Run: `npm run test`
Expected: full suite passes (34 pre-existing — Plan 1's 29 plus Task 2's 5 schema tests — plus 5 new = 39)

- [ ] **Step 5: Commit**

```bash
git add src/main/project/projectApi.ts src/main/project/projectApi.test.ts
git commit -m "Add readTimeline and addTimelineItem"
```

---

### Task 4: Remotion composition

**Files:**
- Create: `src/remotion/constants.ts`, `src/remotion/types.ts`, `src/remotion/timelineDuration.ts`, `src/remotion/items/ImageItem.tsx`, `src/remotion/itemRegistry.tsx`, `src/remotion/DemoComposition.tsx`, `src/remotion/index.ts`
- Test: `src/remotion/timelineDuration.test.ts`, `src/main/render/composition.test.ts`

**Interfaces:**
- Consumes: `remotion`, `@remotion/renderer`, `@remotion/bundler` (Task 1)
- Produces:
  - `FPS`, `WIDTH`, `HEIGHT` constants
  - `interface TimelineItem { id, kind, start, duration, data }` (plain TS shape — this is the renderer-side twin of Task 2's Zod-inferred type; see the note on shared types below)
  - `computeTimelineDuration(timeline: TimelineItem[]): number`
  - `DemoComposition({ timeline }: { timeline: TimelineItem[] }): JSX.Element` — used by Task 5 (`renderProject.ts`, via the bundled `index.ts` entry) and Task 8 (`<Player>` in Editor.tsx)
  - `COMPOSITION_ID = 'Demo'` (exported from `index.ts`) — used by Task 5

**A note on the duplicated `TimelineItem` type:** `src/remotion/types.ts` is a plain TypeScript interface, not imported from `src/main/project/timeline/schema.ts`. This is deliberate for this plan: `src/remotion/` is bundled by TWO separate bundlers (Vite for the Electron renderer, `@remotion/bundler`'s own webpack for export), and keeping it free of any `zod` import avoids pulling Zod (and any transitive Node-only behavior) into the Remotion export bundle. The main-process Zod schema and this plain type must stay in sync by hand for now — if a future plan finds this drifting, that's the moment to solve it (e.g. a `zod-to-ts`-style generation step), not before.

- [ ] **Step 1: Write `src/remotion/constants.ts`**

```ts
export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080
```

- [ ] **Step 2: Write `src/remotion/types.ts`**

```ts
export interface TimelineItem {
  id: string
  kind: string
  start: number
  duration: number
  data: unknown
}
```

- [ ] **Step 3: Write the failing test for `timelineDuration`**

```ts
import { describe, expect, it } from 'vitest'
import { computeTimelineDuration } from './timelineDuration'

describe('computeTimelineDuration', () => {
  it('returns 1 for an empty timeline (Remotion cannot have a zero-length composition)', () => {
    expect(computeTimelineDuration([])).toBe(1)
  })

  it('returns the end frame of the single item', () => {
    expect(computeTimelineDuration([{ id: 'a', kind: 'image', start: 0, duration: 90, data: {} }])).toBe(90)
  })

  it('returns the furthest end frame across overlapping and sequential items', () => {
    const timeline = [
      { id: 'a', kind: 'image', start: 0, duration: 90, data: {} },
      { id: 'b', kind: 'image', start: 30, duration: 30, data: {} }, // ends at 60, inside item a
      { id: 'c', kind: 'image', start: 90, duration: 60, data: {} } // ends at 150, the furthest
    ]

    expect(computeTimelineDuration(timeline)).toBe(150)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/remotion/timelineDuration.test.ts`
Expected: FAIL — `Cannot find module './timelineDuration'`

- [ ] **Step 5: Write `src/remotion/timelineDuration.ts`**

```ts
import type { TimelineItem } from './types'

export function computeTimelineDuration(timeline: TimelineItem[]): number {
  if (timeline.length === 0) return 1
  return Math.max(...timeline.map((item) => item.start + item.duration))
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/remotion/timelineDuration.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Write `src/remotion/items/ImageItem.tsx`**

```tsx
import { Img } from 'remotion'

export function ImageItem({ data }: { data: unknown }): JSX.Element {
  const { src } = data as { src: string }
  const url = src.startsWith('file://') ? src : `file://${src}`

  return <Img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
}
```

- [ ] **Step 8: Write `src/remotion/itemRegistry.tsx`**

```tsx
import type { ComponentType } from 'react'
import { ImageItem } from './items/ImageItem'

export const ITEM_REGISTRY: Record<string, ComponentType<{ data: unknown }>> = {
  image: ImageItem
}
```

- [ ] **Step 9: Write `src/remotion/DemoComposition.tsx`**

```tsx
import { Sequence } from 'remotion'
import type { TimelineItem } from './types'
import { ITEM_REGISTRY } from './itemRegistry'

export function DemoComposition({ timeline }: { timeline: TimelineItem[] }): JSX.Element {
  return (
    <>
      {timeline.map((item) => {
        const Component = ITEM_REGISTRY[item.kind]
        if (!Component) return null
        return (
          <Sequence key={item.id} from={item.start} durationInFrames={item.duration}>
            <Component data={item.data} />
          </Sequence>
        )
      })}
    </>
  )
}
```

- [ ] **Step 10: Write `src/remotion/index.ts`**

```ts
import { registerRoot, Composition } from 'remotion'
import { DemoComposition } from './DemoComposition'
import { FPS, WIDTH, HEIGHT } from './constants'

export const COMPOSITION_ID = 'Demo'

function RemotionRoot(): JSX.Element {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={DemoComposition}
      durationInFrames={150}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ timeline: [] }}
    />
  )
}

registerRoot(RemotionRoot)
```

- [ ] **Step 11: Write a real smoke test that renders one frame**

This is the first genuinely automated proof that the composition actually mounts and resolves a local image file — `@remotion/renderer` manages its own headless Chromium, so this runs for real in this (or any) environment, no display needed. It will download a browser binary on first run if one isn't cached (`@remotion/renderer` handles this automatically) — expect the first run to take noticeably longer (up to a couple of minutes) than subsequent runs.

Create `src/main/render/composition.test.ts`:

```ts
import { describe, expect, it, afterAll } from 'vitest'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// A minimal valid 1x1 PNG, so the test doesn't depend on any real image asset.
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('DemoComposition (real Remotion render)', () => {
  it('renders a still frame containing the image item without throwing', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'demo-editor-render-test-'))
    const imagePath = join(tmpDir, 'pixel.png')
    writeFileSync(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'))
    const outputPath = join(tmpDir, 'frame.png')

    const bundleLocation = await bundle({ entryPoint: join(process.cwd(), 'src/remotion/index.ts') })
    const timeline = [{ id: 'a', kind: 'image', start: 0, duration: 90, data: { src: imagePath } }]
    const composition = await selectComposition({ serveUrl: bundleLocation, id: 'Demo', inputProps: { timeline } })

    await renderStill({
      composition,
      serveUrl: bundleLocation,
      output: outputPath,
      inputProps: { timeline },
      frame: 0
    })

    const { statSync } = await import('fs')
    expect(statSync(outputPath).size).toBeGreaterThan(0)

    rmSync(tmpDir, { recursive: true, force: true })
  }, 120_000)
})
```

If the installed Remotion version's TypeScript types don't match `bundle`/`selectComposition`/`renderStill`'s exact parameter names above, check `node_modules/@remotion/bundler/dist/index.d.ts` and `node_modules/@remotion/renderer/dist/index.d.ts` for the actual signatures and adapt — the approach (bundle the entry point once, select the composition with real `inputProps`, render a frame, assert the output file is non-empty) stays the same regardless of minor signature differences across versions.

- [ ] **Step 12: Run the test to verify it passes**

Run: `npx vitest run src/main/render/composition.test.ts`
Expected: PASS (1 test — may take up to a couple of minutes on first run while Remotion downloads its headless browser)

- [ ] **Step 13: Commit**

```bash
git add src/remotion src/main/render/composition.test.ts
git commit -m "Add Remotion composition for the image timeline item kind"
```

---

### Task 5: Export pipeline

**Files:**
- Create: `src/main/render/renderProject.ts`
- Test: `src/main/render/renderProject.test.ts`

**Interfaces:**
- Consumes: `readTimeline` (Task 3), `findProjectDir` (Plan 1), `computeTimelineDuration`, `FPS`/`WIDTH`/`HEIGHT`, `COMPOSITION_ID` (Task 4)
- Produces: `renderProjectVideo(id: string, baseDir?: string): Promise<string>` (returns the absolute path of the rendered MP4) — used by Task 7 (IPC handler)

- [ ] **Step 1: Write the failing test**

This is a real end-to-end render — creates an actual project via `ProjectAPI`, adds a real image item, and renders a real MP4. Slower than a unit test (expect tens of seconds), but it is the test that actually proves the export pipeline works, not a mock of it.

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, statSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../project/projectApi'
import { addTimelineItem } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { renderProjectVideo } from './renderProject'

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('renderProjectVideo', () => {
  it('renders the project timeline to a real MP4 file in renders/', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-render-test-'))
    const project = createProject('Render Test', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    const imagePath = join(dir, 'sources', 'images', 'pixel.png')
    writeFileSync(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'))
    addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: imagePath } }, baseDir)

    const outputPath = await renderProjectVideo(project.id, baseDir)

    expect(statSync(outputPath).size).toBeGreaterThan(0)
    expect(readdirSync(join(dir, 'renders'))).toContain(outputPath.split('/').pop())

    rmSync(baseDir, { recursive: true, force: true })
  }, 180_000)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/render/renderProject.test.ts`
Expected: FAIL — `Cannot find module './renderProject'`

- [ ] **Step 3: Write the implementation**

```ts
import { homedir } from 'os'
import { join } from 'path'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { readTimeline } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { computeTimelineDuration } from '../../remotion/timelineDuration'
import { COMPOSITION_ID } from '../../remotion/index'

export async function renderProjectVideo(id: string, baseDir: string = homedir()): Promise<string> {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const timeline = readTimeline(id, baseDir)
  const bundleLocation = await bundle({ entryPoint: join(process.cwd(), 'src/remotion/index.ts') })
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: COMPOSITION_ID,
    inputProps: { timeline }
  })

  const outputPath = join(dir, 'renders', `export-${Date.now()}.mp4`)

  await renderMedia({
    composition: { ...composition, durationInFrames: computeTimelineDuration(timeline) },
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps: { timeline }
  })

  return outputPath
}
```

As with Task 4's smoke test, if the installed Remotion version's types don't match `selectComposition`/`renderMedia`'s exact parameter shape, check `node_modules/@remotion/renderer/dist/index.d.ts` and adapt — the approach (bundle once, select with real `inputProps`, override the resolved duration with the real computed one, render) is what matters, not the exact parameter names.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/render/renderProject.test.ts`
Expected: PASS (1 test — may take a minute or more)

- [ ] **Step 5: Commit**

```bash
git add src/main/render/renderProject.ts src/main/render/renderProject.test.ts
git commit -m "Add renderProjectVideo export pipeline"
```

---

### Task 6: `importImage`

**Files:**
- Modify: `src/main/project/projectApi.ts`
- Modify: `src/main/project/projectApi.test.ts`

**Interfaces:**
- Consumes: `addTimelineItem` (Task 3), `findProjectDir` (Plan 1)
- Produces: `importImage(id: string, sourcePath: string, baseDir?: string): TimelineItem` — used by Task 7 (IPC handler)

This function takes an already-selected file path (the native file-picker dialog itself is Task 7's concern, since `dialog.showOpenDialog` is Electron-specific and belongs in the IPC handler, not in the testable `ProjectAPI` layer).

- [ ] **Step 1: Write the failing test**

Append to `src/main/project/projectApi.test.ts` (fold `importImage` into the existing `./projectApi` import):

```ts
describe('importImage', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('copies the source file into sources/images and adds a timeline item', () => {
    const project = createProject('Import Image', baseDir)
    const sourcePath = join(baseDir, 'original.png')
    writeFileSync(sourcePath, 'fake-png-bytes')

    const item = importImage(project.id, sourcePath, baseDir)

    expect(item.kind).toBe('image')
    const data = item.data as { src: string }
    expect(existsSync(data.src)).toBe(true)
    expect(readFileSync(data.src, 'utf-8')).toBe('fake-png-bytes')
    expect(readTimeline(project.id, baseDir)).toEqual([item])
  })

  it('places the copy inside the project sources/images directory, not the source location', () => {
    const project = createProject('Import Image Location', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    const sourcePath = join(baseDir, 'original.png')
    writeFileSync(sourcePath, 'fake-png-bytes')

    const item = importImage(project.id, sourcePath, baseDir)

    const data = item.data as { src: string }
    expect(data.src.startsWith(join(dir, 'sources', 'images'))).toBe(true)
  })

  it('appends after the current end of the timeline rather than always starting at 0', () => {
    const project = createProject('Import Sequential', baseDir)
    const sourcePath = join(baseDir, 'original.png')
    writeFileSync(sourcePath, 'fake-png-bytes')

    const first = importImage(project.id, sourcePath, baseDir)
    const second = importImage(project.id, sourcePath, baseDir)

    expect(second.start).toBe(first.start + first.duration)
  })
})
```

(Add `writeFileSync`, `existsSync` to the existing `fs` import at the top of the test file if not already present, and `findProjectDir` to the existing `./paths` import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/project/projectApi.test.ts`
Expected: FAIL — `importImage is not a function`

- [ ] **Step 3: Write the implementation**

Add to `src/main/project/projectApi.ts` (add `copyFileSync` to the existing `fs` import, `basename` to the existing `path` import):

```ts
const DEFAULT_IMAGE_DURATION_FRAMES = 90

export function importImage(id: string, sourcePath: string, baseDir: string = homedir()): TimelineItem {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const destPath = join(dir, 'sources', 'images', `${randomUUID()}-${basename(sourcePath)}`)
  copyFileSync(sourcePath, destPath)

  const timeline = readTimeline(id, baseDir)
  const start = timeline.length === 0 ? 0 : Math.max(...timeline.map((item) => item.start + item.duration))

  return addTimelineItem(id, { kind: 'image', start, duration: DEFAULT_IMAGE_DURATION_FRAMES, data: { src: destPath } }, baseDir)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/project/projectApi.test.ts`
Expected: PASS (all tests including the 3 new ones)

Run: `npm run test`
Expected: full suite passes

- [ ] **Step 5: Commit**

```bash
git add src/main/project/projectApi.ts src/main/project/projectApi.test.ts
git commit -m "Add importImage"
```

---

### Task 7: IPC handlers and preload

**Files:**
- Create: `src/main/ipc/timelineHandlers.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Interfaces:**
- Consumes: `readTimeline`, `addTimelineItem`, `importImage` (Tasks 3, 6), `renderProjectVideo` (Task 5)
- Produces:
  - `window.api.timeline.read(id): Promise<TimelineItem[]>`
  - `window.api.timeline.addItem(id, item): Promise<TimelineItem>`
  - `window.api.render.exportVideo(id): Promise<string>`
  - `window.api.project.importImage(id): Promise<TimelineItem>` (shows a native file picker internally; no path argument from the renderer)
  - Used by Task 8 (`projectClient.ts`, `Editor.tsx`)

This is IPC plumbing over already-tested logic — no new business logic, so verification is manual/DOM-based rather than unit-tested, matching Plan 1's Task 9 pattern.

- [ ] **Step 1: Write `src/main/ipc/timelineHandlers.ts`**

```ts
import type { IpcMain, BrowserWindow } from 'electron'
import { dialog } from 'electron'
import { readTimeline, addTimelineItem, importImage } from '../project/projectApi'
import { renderProjectVideo } from '../render/renderProject'

export function registerTimelineHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('project:timeline:read', (_event, id: string) => readTimeline(id))

  ipcMain.handle(
    'project:timeline:addItem',
    (_event, id: string, item: { kind: string; start: number; duration: number; data: unknown }) =>
      addTimelineItem(id, item)
  )

  ipcMain.handle('project:render:export', (_event, id: string) => renderProjectVideo(id))

  ipcMain.handle('project:import:image', async (_event, id: string) => {
    const window = getWindow()
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
        })
      : await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
        })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return importImage(id, result.filePaths[0])
  })
}
```

- [ ] **Step 2: Wire it into `src/main/index.ts`**

Add the import:

```ts
import { registerTimelineHandlers } from './ipc/timelineHandlers'
```

`createWindow()` currently creates `mainWindow` as a local variable. Change it to assign to a module-level `let mainWindowRef: BrowserWindow | null = null` (set inside `createWindow()` right after construction) so `registerTimelineHandlers` can look it up lazily via a getter — the dialog handler needs the CURRENT window, not whichever one existed at registration time (registration happens once, before any window exists).

```ts
let mainWindowRef: BrowserWindow | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    /* ...unchanged... */
  })
  mainWindowRef = mainWindow
  // ...unchanged loadURL/loadFile...
}
```

Inside `app.whenReady().then(() => { ... })`, alongside the existing `registerProjectHandlers(ipcMain)` call:

```ts
registerTimelineHandlers(ipcMain, () => mainWindowRef)
```

- [ ] **Step 3: Extend `src/preload/index.ts`**

Add to the existing file (alongside the existing `projectApi` object — add `importImage` into it, and add two new exported objects):

Following the same pattern Plan 1 established for `ProjectMetadata`/`ProjectSummary` (a type-only import across the process boundary, erased at compile time — confirmed working by Plan 1's final review), import `TimelineItem` from the main-process schema rather than from `src/remotion/types.ts`. `src/remotion/types.ts`'s plain interface exists to keep `zod` out of the *Remotion webpack bundle* (Task 4's note) — that constraint doesn't apply to preload, which already imports Zod-adjacent types from `schema.ts` today with no issue, so preload should use the single canonical validated type rather than introduce a third redundant declaration.

```ts
import type { TimelineItem } from '../main/project/timeline/schema'

// Inside the existing `projectApi` object, add:
//   importImage: (id: string): Promise<TimelineItem | null> => ipcRenderer.invoke('project:import:image', id)

const timelineApi = {
  read: (id: string): Promise<TimelineItem[]> => ipcRenderer.invoke('project:timeline:read', id),
  addItem: (id: string, item: { kind: string; start: number; duration: number; data: unknown }): Promise<TimelineItem> =>
    ipcRenderer.invoke('project:timeline:addItem', id, item)
}

const renderApi = {
  exportVideo: (id: string): Promise<string> => ipcRenderer.invoke('project:render:export', id)
}

// Change the exposeInMainWorld call to:
// contextBridge.exposeInMainWorld('api', { project: projectApi, timeline: timelineApi, render: renderApi })

export type TimelineApi = typeof timelineApi
export type RenderApi = typeof renderApi
```

- [ ] **Step 4: Extend `src/preload/index.d.ts`**

```ts
import type { TimelineApi, RenderApi } from './index'

declare global {
  interface Window {
    api: {
      project: ProjectApi // unchanged from Plan 1, now also has importImage
      timeline: TimelineApi
      render: RenderApi
    }
  }
}
```

- [ ] **Step 5: Manual verification**

Run: `npm run typecheck`
Expected: exits 0

Run: `npm run dev` (backgrounded, ~15s timeout is enough), no window will render (headless environment, per Global Constraints) but the process should start without throwing. Capture stdout/stderr and confirm no error mentioning `timelineHandlers`, `registerTimelineHandlers`, or a failed IPC registration.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/timelineHandlers.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "Wire timeline, render, and image-import through IPC"
```

---

### Task 8: Editor UI — preview, timeline strip, import button

**Files:**
- Modify: `src/renderer/src/api/projectClient.ts`
- Modify: `src/renderer/src/screens/Editor.tsx`

**Interfaces:**
- Consumes: `window.api.timeline.read/addItem`, `window.api.render.exportVideo`, `window.api.project.importImage` (Task 7), `DemoComposition`, `FPS`/`WIDTH`/`HEIGHT`, `computeTimelineDuration` (Task 4)
- Produces: updated `Editor` component — this is the last task before the full end-to-end verification in Task 9

**Headless environment reminder (see Global Constraints):** this task's verification uses the same temporary, always-reverted `webContents.executeJavaScript` DOM-simulation technique Plan 1 used for its `ProjectBrowser`/`Editor` tasks — there is no visible window in this environment. The steps below describe what to implement; verification technique is in Step 5.

- [ ] **Step 1: Add timeline/render/importImage wrappers to `projectClient.ts`**

Add to `src/renderer/src/api/projectClient.ts`. Plan 1's `ProjectMetadata`/`ProjectSummary` in this file are hand-duplicated local interfaces (flagged by Plan 1's final review as worth fixing before this plan introduced a new cross-boundary type) — don't repeat that pattern for the new `TimelineItem` type. Import it the same type-only way Task 7 imports it into preload:

```ts
import type { TimelineItem } from '../../../main/project/timeline/schema'

export type { TimelineItem }

export const timelineClient = {
  read: (id: string): Promise<TimelineItem[]> => window.api.timeline.read(id),
  addItem: (id: string, item: { kind: string; start: number; duration: number; data: unknown }): Promise<TimelineItem> =>
    window.api.timeline.addItem(id, item)
}

export const renderClient = {
  exportVideo: (id: string): Promise<string> => window.api.render.exportVideo(id)
}

// Add to the existing `projectClient` object:
//   importImage: (id: string): Promise<TimelineItem | null> => window.api.project.importImage(id)
```

- [ ] **Step 2: Update `Editor.tsx`**

Replace the file's contents:

```tsx
import { useEffect, useState } from 'react'
import { Player } from '@remotion/player'
import { projectClient, timelineClient, renderClient, type ProjectMetadata, type TimelineItem } from '../api/projectClient'
import { DemoComposition } from '../../../remotion/DemoComposition'
import { FPS, WIDTH, HEIGHT } from '../../../remotion/constants'
import { computeTimelineDuration } from '../../../remotion/timelineDuration'

export function Editor({ projectId }: { projectId: string }): JSX.Element {
  const [project, setProject] = useState<ProjectMetadata | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportedPath, setExportedPath] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([projectClient.open(projectId), timelineClient.read(projectId)])
      .then(([openedProject, items]) => {
        setProject(openedProject)
        setTimeline(items)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [projectId])

  async function handleImportImage(): Promise<void> {
    const item = await projectClient.importImage(projectId)
    if (item) {
      setTimeline(await timelineClient.read(projectId))
    }
  }

  async function handleExport(): Promise<void> {
    setExporting(true)
    try {
      const path = await renderClient.exportVideo(projectId)
      setExportedPath(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  if (error) return <div>{error}</div>
  if (!project) return <div>Loading…</div>

  return (
    <div style={{ display: 'grid', gridTemplateRows: '1fr auto', height: '100vh' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 260px' }}>
        <aside>
          <p>Sources &amp; Agents</p>
          <button onClick={handleImportImage}>Import Image</button>
          <button onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export Video'}
          </button>
          {exportedPath && <p>Exported to: {exportedPath}</p>}
        </aside>
        <main>
          {timeline.length > 0 ? (
            <Player
              component={DemoComposition}
              inputProps={{ timeline }}
              durationInFrames={computeTimelineDuration(timeline)}
              fps={FPS}
              compositionWidth={WIDTH}
              compositionHeight={HEIGHT}
              style={{ width: '100%', height: '100%' }}
              controls
            />
          ) : (
            <p>Preview — {project.name}</p>
          )}
        </main>
        <aside>Transcript</aside>
      </div>
      <footer style={{ height: 160, display: 'flex', gap: 4 }}>
        {timeline.map((item) => (
          <div key={item.id} style={{ width: `${item.duration}px`, background: '#cfe8ff' }}>
            {item.kind}
          </div>
        ))}
      </footer>
    </div>
  )
}
```

- [ ] **Step 3: Verify the renderer bundles files outside `src/renderer/`**

The imports above (`../../../remotion/DemoComposition` etc.) cross out of `src/renderer/src/screens/` into the top-level `src/remotion/` directory. Vite resolves this fine via normal relative-path module resolution (it doesn't restrict imports to within its configured `root`), but confirm it:

Run: `npm run typecheck`
Expected: exits 0

Run: `npm run build`
Expected: exits 0, and `out/renderer/assets/*.js` should be noticeably larger than Plan 1's build (Remotion's player + composition code is now bundled in) — a rough sanity check, not an exact assertion.

- [ ] **Step 4: Manual verification (DOM-simulation substitute — headless environment)**

Add a temporary (NOT committed) `did-finish-load` block to `src/main/index.ts`'s `createWindow()` — follow the exact pattern used in Plan 1's Task 9-11 (a `webContents.executeJavaScript` call that waits for initial data to load, drives the DOM with simulated native input events, and logs `document.body.innerText` or specific element state). For this task:

1. Simulate opening the project you'll create for this check (or create one via the same input+click simulation Plan 1's `ProjectBrowser` task used).
2. Once in the Editor, click the "Import Image" button via simulated click. Since `importImage` opens a real native OS file dialog (`dialog.showOpenDialog`), which cannot be driven by DOM simulation, this manual check should instead directly call `window.api.project.importImage` is not testable this way — SKIP driving the actual dialog. Instead, verify the import path programmatically: call `window.api.timeline.addItem(projectId, { kind: 'image', start: 0, duration: 90, data: { src: '<path to a real tiny test PNG you write to a temp location first> ' } })` directly via `executeJavaScript`, matching how Task 4/5's tests created their own test image.
3. After adding the item, capture `document.body.innerText` — it should not show the placeholder `Preview — ` text anymore (since `timeline.length > 0` now), and should show the imported item's `kind` (`image`) in the footer timeline strip.
4. Revert the temporary instrumentation from `src/main/index.ts` — confirm with `git diff src/main/index.ts` that it shows no changes for this task.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/api/projectClient.ts src/renderer/src/screens/Editor.tsx
git commit -m "Add Player preview, timeline strip, and image import to the Editor"
```

---

### Task 9: Full plan verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `npm run test`
Expected: PASS — every suite from Plan 1 plus this plan's new ones (schema, projectApi's timeline/import additions, composition smoke test, renderProject). This run will be slower than Plan 1's (the two real Remotion render tests take real wall-clock time) — that's expected, not a regression.

- [ ] **Step 2: Run the full typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0

- [ ] **Step 3: End-to-end proof, exercised as a script rather than through the UI**

This proves the whole pipeline — create, import, preview data, export — using the same `ProjectAPI` the UI calls, without needing a visible window. Create a throwaway script (do not commit it):

```ts
// scratch-e2e.ts — run with: npx tsx scratch-e2e.ts   (or ts-node, whichever is available)
import { writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { createProject } from './src/main/project/projectApi'
import { importImage } from './src/main/project/projectApi'
import { readTimeline } from './src/main/project/projectApi'
import { renderProjectVideo } from './src/main/render/renderProject'
import { findProjectDir } from './src/main/project/paths'

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function main(): Promise<void> {
  const project = createProject('E2E Smoke Test')
  const dir = findProjectDir(project.id) as string
  const sourceImagePath = join(dir, 'test-source.png')
  writeFileSync(sourceImagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'))

  const item = importImage(project.id, sourceImagePath)
  console.log('Imported item:', item)

  const timeline = readTimeline(project.id)
  console.log('Timeline now has', timeline.length, 'item(s)')

  const outputPath = await renderProjectVideo(project.id)
  console.log('Rendered to:', outputPath, '-', statSync(outputPath).size, 'bytes')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

Run it (adjust the runner to whatever TypeScript execution tool is available in this project — `npx tsx scratch-e2e.ts` is the most likely to work with zero extra setup; if unavailable, compile with `npx tsc scratch-e2e.ts --outDir /tmp/e2e-out` and run the output with `node`).

Expected: prints the imported item, confirms the timeline has 1 item, and prints a real output path with a non-zero byte size.

- [ ] **Step 4: Clean up**

Delete the scratch script and the real project it created:

```bash
rm scratch-e2e.ts
ls ~/DemoStudio/Projects  # find the "e2e-smoke-test" directory
rm -rf ~/DemoStudio/Projects/*-e2e-smoke-test
```

- [ ] **Step 5: Final commit** (only if any of the above required fixes)

```bash
git add -A
git commit -m "Fix issues found in Plan 2 full verification"
```

If nothing needed fixing, there is nothing to commit — Plan 2 is complete.
