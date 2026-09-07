# Project Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Electron + React + TypeScript app shell with a working `ProjectAPI` that can create, list, open, and schema-migrate projects stored on disk under `~/DemoStudio/Projects/`, plus a minimal UI to create/open a project and land in an empty editor shell.

**Architecture:** Electron main process owns all filesystem access through a `ProjectAPI` module (pure Node/TypeScript, unit-testable without Electron); IPC handlers expose it to a React renderer via a `contextBridge` preload. No embedded database — a project is a folder of JSON files, written atomically. This is the walking skeleton every later plan (capture, timeline/Remotion, transcript/TTS, agents) attaches to.

**Tech Stack:** Electron, electron-vite, React 18, TypeScript, Zod (schema validation), Vitest (unit tests).

**Spec:** `docs/superpowers/specs/2026-09-06-demo-editor-design.md`

## Global Constraints

- Projects live at `~/DemoStudio/Projects/<project-id>-<slug>/` (spec §4). `baseDir` (defaulting to `os.homedir()`) is threaded through every project-path function as a parameter so tests never touch the real home directory.
- `project.json` carries `schemaVersion` from v1 onward; opening a project must go through the migration mechanism, never read the file raw (spec §4, §11).
- All writes to project files are atomic — write to a temp file, then rename over the target (spec §4).
- A project is files only — no embedded database (spec §2, §4).
- macOS only for v1 (spec §1) — no cross-platform path or packaging handling is needed yet.
- No comments explaining *what* code does — only where a non-obvious constraint (like the ones above) needs flagging.

---

## Plan sequence context

This is **Plan 1 of a multi-plan implementation** of the full spec (per the spec's own §11 walking-skeleton order). It is scoped to be a complete, working, testable slice on its own: create a project, see it on disk, close the app, reopen it. Anticipated later plans, each building on this one's `ProjectAPI` and file layout:

- **Plan 2** — Timeline data model, `TimelineItem` kind registry, Remotion compositor (preview + export), image/PPT import.
- **Plan 3** — Capture pipeline (Playwright recording, action log, recording toolbar).
- **Plan 4** — Transcript panel, `TTSProvider` interface, per-segment narration.
- **Plan 5** — Agent host (provider-agnostic tool-use loop), `LLMProvider` implementations, Transcript Agent, model settings UI.

Do not implement anything from those plans here — Task 11's editor shell is intentionally empty (regions only), and `timeline.json`/`transcript.json` are created as empty arrays with no item-kind logic yet.

---

## File Structure

```
package.json
tsconfig.json
tsconfig.node.json
tsconfig.web.json
electron.vite.config.ts
vitest.config.ts
src/
  main/
    index.ts                          # Electron entry, creates the window
    ipc/
      projectHandlers.ts               # ipcMain.handle wiring -> projectApi
    project/
      schema.ts                        # ProjectMetadata Zod schema, CURRENT_SCHEMA_VERSION
      slug.ts                          # slugify()
      slug.test.ts
      paths.ts                         # projectsRootDir, projectDirName, findProjectDir
      paths.test.ts
      atomicWrite.ts                   # writeJsonAtomic()
      atomicWrite.test.ts
      migrate.ts                       # migrateProjectMetadata(), UnsupportedSchemaVersionError
      migrate.test.ts
      projectApi.ts                    # createProject, listProjects, openProject
      projectApi.test.ts
  preload/
    index.ts                           # contextBridge exposure of window.api.project
    index.d.ts                         # ambient Window.api typing
  renderer/
    index.html
    src/
      main.tsx
      App.tsx
      api/
        projectClient.ts               # thin window.api.project wrapper + shared types
      screens/
        ProjectBrowser.tsx
        Editor.tsx
```

---

### Task 1: Scaffold Electron + Vite + React + TypeScript + Vitest

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `electron.vite.config.ts`, `vitest.config.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`
- Modify: `.gitignore` (this repo's current `.gitignore` is a leftover Go template — add Node/Electron entries alongside it, don't remove the existing content without asking)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a working `npm run dev` (Electron window), `npm run build` (typecheck + bundle), `npm run test` (Vitest) command set that every later task relies on

- [ ] **Step 1: Add Node/Electron ignores to `.gitignore`**

Append to the existing `.gitignore`:

```
# Node / Electron
node_modules/
out/
dist/
.vite/
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "demo-editor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "electron": "^32.0.0",
    "electron-vite": "^2.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

- [ ] **Step 4: Write `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src/main/**/*", "src/preload/**/*", "vitest.config.ts"]
}
```

- [ ] **Step 5: Write `tsconfig.web.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src/renderer/src/**/*", "src/preload/index.d.ts"]
}
```

`src/preload/index.d.ts` (written in Task 9) declares the global `Window.api` augmentation the renderer needs — it must be in this config's `include` even though it lives outside `src/renderer/`, or `npm run typecheck` fails once Task 10 calls `window.api.project.*`.

- [ ] **Step 6: Write `electron.vite.config.ts`**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()]
  }
})
```

- [ ] **Step 7: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts']
  }
})
```

- [ ] **Step 8: Write `src/main/index.ts`**

```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

(`ipcMain` is imported but unused until Task 9 registers handlers — this is expected for this step; do not remove the import or add handlers early.)

- [ ] **Step 9: Write `src/preload/index.ts`**

```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {})
```

- [ ] **Step 10: Write `src/renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Demo Editor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 11: Write `src/renderer/src/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 12: Write `src/renderer/src/App.tsx`** (placeholder — replaced in Task 10)

```tsx
export default function App(): JSX.Element {
  return <h1>Demo Editor</h1>
}
```

- [ ] **Step 13: Install dependencies**

Run: `npm install`
Expected: installs cleanly, creates `package-lock.json`

- [ ] **Step 14: Verify the build and dev pipeline**

Run: `npm run typecheck`
Expected: exits 0, no errors

Run: `npm run build`
Expected: exits 0, produces `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`

Run: `npm run dev`
Expected: an Electron window opens showing "Demo Editor". Close the window/quit the app before continuing.

- [ ] **Step 15: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig*.json electron.vite.config.ts vitest.config.ts src
git commit -m "Scaffold Electron + React + TypeScript + Vitest app shell"
```

---

### Task 2: `slugify` helper

**Files:**
- Create: `src/main/project/slug.ts`
- Test: `src/main/project/slug.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `slugify(name: string): string` — used by Task 3 (`paths.ts` is unaffected) and Task 6 (`createProject`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { slugify } from './slug'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Checkout Flow Demo')).toBe('checkout-flow-demo')
  })

  it('strips non-alphanumeric characters', () => {
    expect(slugify('Q3 Launch! (v2)')).toBe('q3-launch-v2')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --Weird Name--  ')).toBe('weird-name')
  })

  it('falls back to "untitled" for an empty result', () => {
    expect(slugify('***')).toBe('untitled')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/project/slug.test.ts`
Expected: FAIL — `Cannot find module './slug'`

- [ ] **Step 3: Write minimal implementation**

```ts
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'untitled'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/project/slug.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/project/slug.ts src/main/project/slug.test.ts
git commit -m "Add slugify helper for project folder names"
```

---

### Task 3: Project path helpers

**Files:**
- Create: `src/main/project/paths.ts`
- Test: `src/main/project/paths.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `projectsRootDir(baseDir?: string): string`
  - `projectDirName(id: string, slug: string): string`
  - `findProjectDir(id: string, baseDir?: string): string | undefined`
  - `PROJECT_SUBDIRS: readonly string[]`
  - Used by Task 6, 7, 8 (`projectApi.ts`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { projectsRootDir, projectDirName, findProjectDir, PROJECT_SUBDIRS } from './paths'

describe('paths', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('builds the projects root under DemoStudio/Projects', () => {
    expect(projectsRootDir(baseDir)).toBe(join(baseDir, 'DemoStudio', 'Projects'))
  })

  it('builds a project directory name from id and slug', () => {
    expect(projectDirName('abc123', 'checkout-flow')).toBe('abc123-checkout-flow')
  })

  it('finds an existing project directory by id prefix', () => {
    const root = projectsRootDir(baseDir)
    mkdirSync(join(root, 'abc123-checkout-flow'), { recursive: true })

    expect(findProjectDir('abc123', baseDir)).toBe(join(root, 'abc123-checkout-flow'))
  })

  it('returns undefined when no project matches the id', () => {
    mkdirSync(projectsRootDir(baseDir), { recursive: true })

    expect(findProjectDir('does-not-exist', baseDir)).toBeUndefined()
  })

  it('returns undefined when the projects root does not exist yet', () => {
    expect(findProjectDir('abc123', baseDir)).toBeUndefined()
  })

  it('lists the standard project subdirectories', () => {
    expect(PROJECT_SUBDIRS).toEqual([
      'sources/images',
      'sources/slides',
      'audio',
      'renders',
      'agents/runs'
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/project/paths.test.ts`
Expected: FAIL — `Cannot find module './paths'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { homedir } from 'os'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

export function projectsRootDir(baseDir: string = homedir()): string {
  return join(baseDir, 'DemoStudio', 'Projects')
}

export function projectDirName(id: string, slug: string): string {
  return `${id}-${slug}`
}

export function findProjectDir(id: string, baseDir: string = homedir()): string | undefined {
  const root = projectsRootDir(baseDir)
  if (!existsSync(root)) return undefined

  const match = readdirSync(root, { withFileTypes: true }).find(
    (entry) => entry.isDirectory() && entry.name.startsWith(`${id}-`)
  )

  return match ? join(root, match.name) : undefined
}

export const PROJECT_SUBDIRS = [
  'sources/images',
  'sources/slides',
  'audio',
  'renders',
  'agents/runs'
] as const
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/project/paths.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/project/paths.ts src/main/project/paths.test.ts
git commit -m "Add project path helpers"
```

---

### Task 4: Atomic JSON write helper

**Files:**
- Create: `src/main/project/atomicWrite.ts`
- Test: `src/main/project/atomicWrite.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `writeJsonAtomic(filePath: string, data: unknown): void` — used by Task 6 (`createProject`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeJsonAtomic } from './atomicWrite'

describe('writeJsonAtomic', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes pretty-printed JSON to the target path', () => {
    const target = join(dir, 'project.json')
    writeJsonAtomic(target, { id: 'abc123', name: 'Test' })

    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ id: 'abc123', name: 'Test' })
  })

  it('leaves no temp file behind after a successful write', () => {
    writeJsonAtomic(join(dir, 'project.json'), { ok: true })

    expect(readdirSync(dir)).toEqual(['project.json'])
  })

  it('overwrites an existing file', () => {
    const target = join(dir, 'project.json')
    writeJsonAtomic(target, { version: 1 })
    writeJsonAtomic(target, { version: 2 })

    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ version: 2 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/project/atomicWrite.test.ts`
Expected: FAIL — `Cannot find module './atomicWrite'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { writeFileSync, renameSync } from 'fs'
import { dirname, join } from 'path'

export function writeJsonAtomic(filePath: string, data: unknown): void {
  const tempPath = join(
    dirname(filePath),
    `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  )

  writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tempPath, filePath)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/project/atomicWrite.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/project/atomicWrite.ts src/main/project/atomicWrite.test.ts
git commit -m "Add atomic JSON write helper"
```

---

### Task 5: Project schema and migration mechanism

**Files:**
- Create: `src/main/project/schema.ts`
- Create: `src/main/project/migrate.ts`
- Test: `src/main/project/migrate.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `CURRENT_SCHEMA_VERSION: number`
  - `ProjectMetadataSchema: ZodSchema`, `type ProjectMetadata = { id, name, createdAt, schemaVersion }`
  - `type ProjectSummary = { id, name, createdAt }`
  - `migrateProjectMetadata(raw: Record<string, unknown>): ProjectMetadata`
  - `class UnsupportedSchemaVersionError extends Error`
  - Used by Task 6, 7, 8 (`projectApi.ts`)

- [ ] **Step 1: Write `schema.ts`** (no test — pure type/schema declarations, exercised through `migrate.test.ts` below)

```ts
import { z } from 'zod'

export const CURRENT_SCHEMA_VERSION = 1

export const ProjectMetadataSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string(),
  schemaVersion: z.number().int()
})

export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>

export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
}
```

- [ ] **Step 2: Write the failing test for migration**

```ts
import { describe, expect, it } from 'vitest'
import { migrateProjectMetadata, UnsupportedSchemaVersionError } from './migrate'

describe('migrateProjectMetadata', () => {
  it('passes through metadata already at the current schema version', () => {
    const raw = { id: 'abc123', name: 'Checkout Flow', createdAt: '2026-09-06T00:00:00.000Z', schemaVersion: 1 }

    expect(migrateProjectMetadata(raw)).toEqual(raw)
  })

  it('throws UnsupportedSchemaVersionError for a schema version newer than this app supports', () => {
    const raw = { id: 'abc123', name: 'Checkout Flow', createdAt: '2026-09-06T00:00:00.000Z', schemaVersion: 99 }

    expect(() => migrateProjectMetadata(raw)).toThrow(UnsupportedSchemaVersionError)
  })

  it('throws a clear error when a required upgrade path is missing', () => {
    const raw = { id: 'abc123', name: 'Checkout Flow', createdAt: '2026-09-06T00:00:00.000Z' }

    expect(() => migrateProjectMetadata(raw)).toThrow('No migration registered from schema v0')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/project/migrate.test.ts`
Expected: FAIL — `Cannot find module './migrate'`

- [ ] **Step 4: Write minimal implementation**

```ts
import { ProjectMetadataSchema, CURRENT_SCHEMA_VERSION, type ProjectMetadata } from './schema'

export class UnsupportedSchemaVersionError extends Error {
  constructor(foundVersion: number) {
    super(
      `This project was created by a newer version of Demo Editor (schema v${foundVersion}, this app supports up to v${CURRENT_SCHEMA_VERSION}). Update the app to open it.`
    )
    this.name = 'UnsupportedSchemaVersionError'
  }
}

type Migration = (metadata: Record<string, unknown>) => Record<string, unknown>

// Keyed by the version a migration upgrades FROM. Empty until the schema
// changes for the first time after v1 — see spec §4/§11.
const MIGRATIONS: Record<number, Migration> = {}

export function migrateProjectMetadata(raw: Record<string, unknown>): ProjectMetadata {
  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0
  let data = raw

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(version)
  }

  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version]
    if (!migrate) {
      throw new Error(`No migration registered from schema v${version}`)
    }
    data = migrate(data)
    version += 1
  }

  return ProjectMetadataSchema.parse(data)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/project/migrate.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/main/project/schema.ts src/main/project/migrate.ts src/main/project/migrate.test.ts
git commit -m "Add project schema and migration mechanism"
```

---

### Task 6: `createProject`

**Files:**
- Create: `src/main/project/projectApi.ts`
- Test: `src/main/project/projectApi.test.ts`

**Interfaces:**
- Consumes: `slugify` (Task 2), `projectsRootDir`/`projectDirName`/`PROJECT_SUBDIRS` (Task 3), `writeJsonAtomic` (Task 4), `ProjectMetadataSchema`/`CURRENT_SCHEMA_VERSION`/`ProjectMetadata` (Task 5)
- Produces: `createProject(name: string, baseDir?: string): ProjectMetadata` — used by Task 9 (IPC handler)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from './projectApi'
import { projectsRootDir, findProjectDir, PROJECT_SUBDIRS } from './paths'

describe('createProject', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('returns metadata with a generated id and the given name', () => {
    const metadata = createProject('Checkout Flow', baseDir)

    expect(metadata.name).toBe('Checkout Flow')
    expect(metadata.id).toBeTruthy()
    expect(metadata.schemaVersion).toBe(1)
  })

  it('creates the project directory with the expected subdirectories', () => {
    const metadata = createProject('Checkout Flow', baseDir)
    const dir = findProjectDir(metadata.id, baseDir)

    expect(dir).toBeDefined()
    for (const subdir of PROJECT_SUBDIRS) {
      expect(existsSync(join(dir as string, subdir))).toBe(true)
    }
  })

  it('writes project.json, timeline.json, and transcript.json', () => {
    const metadata = createProject('Checkout Flow', baseDir)
    const dir = findProjectDir(metadata.id, baseDir) as string

    expect(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf-8'))).toEqual(metadata)
    expect(JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf-8'))).toEqual([])
    expect(JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf-8'))).toEqual([])
  })

  it('slugifies the name into the folder name', () => {
    const metadata = createProject('Checkout Flow!', baseDir)
    const dir = findProjectDir(metadata.id, baseDir) as string

    expect(dir.endsWith(`${metadata.id}-checkout-flow`)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/project/projectApi.test.ts`
Expected: FAIL — `Cannot find module './projectApi'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { CURRENT_SCHEMA_VERSION, type ProjectMetadata } from './schema'
import { projectsRootDir, projectDirName, PROJECT_SUBDIRS } from './paths'
import { slugify } from './slug'
import { writeJsonAtomic } from './atomicWrite'

export function createProject(name: string, baseDir: string = homedir()): ProjectMetadata {
  const id = randomUUID()
  const slug = slugify(name)
  const dir = join(projectsRootDir(baseDir), projectDirName(id, slug))

  mkdirSync(dir, { recursive: true })
  for (const subdir of PROJECT_SUBDIRS) {
    mkdirSync(join(dir, subdir), { recursive: true })
  }

  const metadata: ProjectMetadata = {
    id,
    name,
    createdAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION
  }

  writeJsonAtomic(join(dir, 'project.json'), metadata)
  writeJsonAtomic(join(dir, 'timeline.json'), [])
  writeJsonAtomic(join(dir, 'transcript.json'), [])

  return metadata
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/project/projectApi.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/project/projectApi.ts src/main/project/projectApi.test.ts
git commit -m "Add createProject"
```

---

### Task 7: `listProjects`

**Files:**
- Modify: `src/main/project/projectApi.ts`
- Modify: `src/main/project/projectApi.test.ts`

**Interfaces:**
- Consumes: `createProject` (Task 6, used to set up fixtures), `migrateProjectMetadata` (Task 5)
- Produces: `listProjects(baseDir?: string): ProjectSummary[]` — used by Task 9 (IPC handler)

- [ ] **Step 1: Add the failing test**

Append to `src/main/project/projectApi.test.ts`:

```ts
import { listProjects } from './projectApi'

describe('listProjects', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('returns an empty list when no projects exist', () => {
    expect(listProjects(baseDir)).toEqual([])
  })

  it('lists created projects newest first', () => {
    const first = createProject('First Project', baseDir)
    const second = createProject('Second Project', baseDir)

    const summaries = listProjects(baseDir)

    expect(summaries.map((p) => p.id)).toEqual([second.id, first.id])
  })

  it('omits schemaVersion from the summary', () => {
    createProject('Checkout Flow', baseDir)

    expect(listProjects(baseDir)[0]).toEqual({
      id: expect.any(String),
      name: 'Checkout Flow',
      createdAt: expect.any(String)
    })
  })
})
```

(Add the `listProjects` import alongside the existing `createProject` import at the top of the file rather than as a second import statement.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/project/projectApi.test.ts`
Expected: FAIL — `listProjects is not a function` / `Cannot find export`

- [ ] **Step 3: Add the implementation**

Add to `src/main/project/projectApi.ts` (alongside the existing imports, add `existsSync, readFileSync, readdirSync` to the `fs` import and `type ProjectSummary` to the schema import, and `migrateProjectMetadata` from `./migrate`):

```ts
export function listProjects(baseDir: string = homedir()): ProjectSummary[] {
  const root = projectsRootDir(baseDir)
  if (!existsSync(root)) return []

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry): ProjectSummary | undefined => {
      const metadataPath = join(root, entry.name, 'project.json')
      if (!existsSync(metadataPath)) return undefined

      const raw = JSON.parse(readFileSync(metadataPath, 'utf-8'))
      const metadata = migrateProjectMetadata(raw)
      return { id: metadata.id, name: metadata.name, createdAt: metadata.createdAt }
    })
    .filter((summary): summary is ProjectSummary => summary !== undefined)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/project/projectApi.test.ts`
Expected: PASS (7 tests total)

- [ ] **Step 5: Commit**

```bash
git add src/main/project/projectApi.ts src/main/project/projectApi.test.ts
git commit -m "Add listProjects"
```

---

### Task 8: `openProject`

**Files:**
- Modify: `src/main/project/projectApi.ts`
- Modify: `src/main/project/projectApi.test.ts`

**Interfaces:**
- Consumes: `findProjectDir` (Task 3), `migrateProjectMetadata` (Task 5)
- Produces: `openProject(id: string, baseDir?: string): ProjectMetadata` — used by Task 9 (IPC handler) and Task 11 (Editor screen, via IPC)

- [ ] **Step 1: Add the failing test**

Append to `src/main/project/projectApi.test.ts`:

```ts
import { openProject } from './projectApi'

describe('openProject', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('returns the full metadata for an existing project', () => {
    const created = createProject('Checkout Flow', baseDir)

    expect(openProject(created.id, baseDir)).toEqual(created)
  })

  it('throws a clear error when the project does not exist', () => {
    expect(() => openProject('does-not-exist', baseDir)).toThrow(
      'No project found with id does-not-exist'
    )
  })
})
```

(Same note as Task 7 — fold the `openProject` import into the existing import line from `./projectApi`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/project/projectApi.test.ts`
Expected: FAIL — `openProject is not a function`

- [ ] **Step 3: Add the implementation**

Add to `src/main/project/projectApi.ts` (add `findProjectDir` to the existing import from `./paths`):

```ts
export function openProject(id: string, baseDir: string = homedir()): ProjectMetadata {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const raw = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf-8'))
  return migrateProjectMetadata(raw)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/project/projectApi.test.ts`
Expected: PASS (9 tests total)

Run: `npm run test`
Expected: PASS — all suites across the `src/main/project/` files (slug, paths, atomicWrite, migrate, projectApi) green.

- [ ] **Step 5: Commit**

```bash
git add src/main/project/projectApi.ts src/main/project/projectApi.test.ts
git commit -m "Add openProject"
```

---

### Task 9: IPC handlers and preload bridge

**Files:**
- Create: `src/main/ipc/projectHandlers.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Create: `src/preload/index.d.ts`

**Interfaces:**
- Consumes: `createProject`, `listProjects`, `openProject` (Tasks 6–8), `ProjectMetadata`/`ProjectSummary` (Task 5)
- Produces: `window.api.project.create(name): Promise<ProjectMetadata>`, `.list(): Promise<ProjectSummary[]>`, `.open(id): Promise<ProjectMetadata>` — used by Task 10 and 11 (renderer screens)

This task wires existing, already-tested logic through Electron IPC — there is no new business logic to unit test here, so verification is manual (Step 4).

- [ ] **Step 1: Write `src/main/ipc/projectHandlers.ts`**

```ts
import type { IpcMain } from 'electron'
import { createProject, listProjects, openProject } from '../project/projectApi'

export function registerProjectHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('project:create', (_event, name: string) => createProject(name))
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:open', (_event, id: string) => openProject(id))
}
```

- [ ] **Step 2: Wire it into `src/main/index.ts`**

Add the import and call:

```ts
import { registerProjectHandlers } from './ipc/projectHandlers'
```

Inside `app.whenReady().then(() => { ... })`, before `createWindow()`:

```ts
registerProjectHandlers(ipcMain)
```

- [ ] **Step 3: Expose the API in `src/preload/index.ts`** (replace the file's contents)

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectMetadata, ProjectSummary } from '../main/project/schema'

const projectApi = {
  create: (name: string): Promise<ProjectMetadata> => ipcRenderer.invoke('project:create', name),
  list: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('project:list'),
  open: (id: string): Promise<ProjectMetadata> => ipcRenderer.invoke('project:open', id)
}

contextBridge.exposeInMainWorld('api', { project: projectApi })

export type ProjectApi = typeof projectApi
```

- [ ] **Step 4: Write `src/preload/index.d.ts`**

```ts
import type { ProjectApi } from './index'

declare global {
  interface Window {
    api: {
      project: ProjectApi
    }
  }
}
```

- [ ] **Step 5: Manual verification**

Run: `npm run typecheck`
Expected: exits 0

Run: `npm run dev`
Expected: window opens showing "Demo Editor" (unchanged from Task 1 — nothing calls the new API yet). Open DevTools (View → Toggle Developer Tools) and run in the console:

```js
await window.api.project.create('Console Test')
await window.api.project.list()
```

Expected: `create` resolves with a metadata object (`id`, `name: "Console Test"`, `createdAt`, `schemaVersion: 1`); `list` resolves with an array containing that project. Quit the app.

Run: `ls ~/DemoStudio/Projects` (Terminal)
Expected: a directory named `<uuid>-console-test` exists. Delete it before continuing: `rm -rf ~/DemoStudio/Projects/*-console-test` — this was a manual smoke-test project, not one you want lingering for later manual checks.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/projectHandlers.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "Wire project API through Electron IPC and preload bridge"
```

---

### Task 10: `ProjectBrowser` screen

**Files:**
- Create: `src/renderer/src/api/projectClient.ts`
- Create: `src/renderer/src/screens/ProjectBrowser.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `window.api.project.*` (Task 9)
- Produces: `ProjectBrowser({ onOpen: (id: string) => void })` component — used by Task 11 (`App.tsx` routing)

Renderer UI wiring — verification is manual (Step 3), matching Task 9.

- [ ] **Step 1: Write `src/renderer/src/api/projectClient.ts`**

```ts
export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
}

export interface ProjectMetadata extends ProjectSummary {
  schemaVersion: number
}

export const projectClient = {
  create: (name: string): Promise<ProjectMetadata> => window.api.project.create(name),
  list: (): Promise<ProjectSummary[]> => window.api.project.list(),
  open: (id: string): Promise<ProjectMetadata> => window.api.project.open(id)
}
```

- [ ] **Step 2: Write `src/renderer/src/screens/ProjectBrowser.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { projectClient, type ProjectSummary } from '../api/projectClient'

export function ProjectBrowser({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [newName, setNewName] = useState('')

  useEffect(() => {
    projectClient.list().then(setProjects)
  }, [])

  async function handleCreate(): Promise<void> {
    if (!newName.trim()) return
    const created = await projectClient.create(newName.trim())
    setNewName('')
    onOpen(created.id)
  }

  return (
    <div>
      <h1>Demo Editor</h1>
      <div>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New project name"
        />
        <button onClick={handleCreate}>Create</button>
      </div>
      <ul>
        {projects.map((project) => (
          <li key={project.id}>
            <button onClick={() => onOpen(project.id)}>{project.name}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Wire it into `src/renderer/src/App.tsx`** (replace the file's contents)

```tsx
import { useState } from 'react'
import { ProjectBrowser } from './screens/ProjectBrowser'

export default function App(): JSX.Element {
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)

  if (openProjectId) {
    return <div>Opened project {openProjectId} (Editor screen lands in Task 11)</div>
  }
  return <ProjectBrowser onOpen={setOpenProjectId} />
}
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`
Expected: the window shows "Demo Editor" with a name input, a Create button, and a list of any existing projects. Type a name, click Create — the screen switches to "Opened project `<id>` (Editor screen lands in Task 11)". Quit the app.

Run: `ls ~/DemoStudio/Projects`
Expected: a new project directory matching the name you typed. Leave it — Task 11's manual check reuses it.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/api/projectClient.ts src/renderer/src/screens/ProjectBrowser.tsx src/renderer/src/App.tsx
git commit -m "Add ProjectBrowser screen"
```

---

### Task 11: `Editor` shell screen and routing

**Files:**
- Create: `src/renderer/src/screens/Editor.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `projectClient.open` (Task 10's client, backed by Task 9's IPC bridge)
- Produces: `Editor({ projectId: string })` component — this is the attachment point for Plan 2's timeline/preview and Plan 4's transcript panel; do not add those regions' real content here, only the layout regions

- [ ] **Step 1: Write `src/renderer/src/screens/Editor.tsx`**

This lays out the four regions from spec §5 (left rail, center preview, top-right transcript, bottom timeline) as empty landmarks — no functionality, that's later plans' work.

```tsx
import { useEffect, useState } from 'react'
import { projectClient, type ProjectMetadata } from '../api/projectClient'

export function Editor({ projectId }: { projectId: string }): JSX.Element {
  const [project, setProject] = useState<ProjectMetadata | null>(null)

  useEffect(() => {
    projectClient.open(projectId).then(setProject)
  }, [projectId])

  if (!project) return <div>Loading…</div>

  return (
    <div style={{ display: 'grid', gridTemplateRows: '1fr auto', height: '100vh' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 260px' }}>
        <aside>Sources &amp; Agents</aside>
        <main>Preview — {project.name}</main>
        <aside>Transcript</aside>
      </div>
      <footer style={{ height: 160 }}>Timeline</footer>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `src/renderer/src/App.tsx`** (replace the file's contents)

```tsx
import { useState } from 'react'
import { ProjectBrowser } from './screens/ProjectBrowser'
import { Editor } from './screens/Editor'

export default function App(): JSX.Element {
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)

  if (openProjectId) {
    return <Editor projectId={openProjectId} />
  }
  return <ProjectBrowser onOpen={setOpenProjectId} />
}
```

- [ ] **Step 3: Manual verification — full create/close/resume cycle**

Run: `npm run dev`
Expected: the project list includes the project created in Task 10's manual check. Click it — the Editor shell renders with "Sources & Agents" on the left, "Preview — `<name>`" centered, "Transcript" top-right, "Timeline" across the bottom. Quit the app entirely (Cmd+Q).

Run: `npm run dev` again
Expected: the same project still appears in the list (this is the "resume" requirement from spec §2/§4 — opening a project from disk after a full restart is the same code path as opening one mid-session, not a special mode). Click it and confirm the Editor shell renders identically. Quit.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/screens/Editor.tsx src/renderer/src/App.tsx
git commit -m "Add Editor shell screen and project-open routing"
```

---

### Task 12: Full plan verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `npm run test`
Expected: PASS — all suites in `src/main/project/` (slug, paths, atomicWrite, migrate, projectApi — 24 tests total across Tasks 2–8)

- [ ] **Step 2: Run the full typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0

- [ ] **Step 3: Confirm no stray manual-test projects remain**

Run: `ls ~/DemoStudio/Projects`
Expected: only intentional projects from your own manual testing remain (the Task 9 "Console Test" project should already have been deleted in that task's Step 5). This isn't a functional requirement — just tidying up before Plan 2 starts using this same directory.

- [ ] **Step 4: Final commit** (only if any of the above required fixes)

```bash
git add -A
git commit -m "Fix issues found in Plan 1 full verification"
```

If nothing needed fixing, there is nothing to commit — Plan 1 is complete.
