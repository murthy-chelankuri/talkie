# HTML Scenes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A timeline clip whose picture is a web page — HTML, CSS, JS — played frame by frame in a sandboxed iframe, in the project's theme, timed to its narration, made by people (describe, template, import, code) and by agents over MCP.

**Architecture:** A scene is an immutable *revision folder* under the project (`sources/html/<revisionId>/`); the clip's `src` is the absolute path of its entry page, so existing URL resolution, path repair and undo work unchanged. The asset server serves scene pages with Talkie's runtime injected and a strict CSP; the runtime replaces the page's clock and answers `seek` messages with `drawn`. `HtmlScene.tsx` hosts the iframe in preview and export; `checkHtmlScene` hosts it in headless Playwright for agents, posters and the in-app checks.

**Tech Stack:** Electron, React, Playwright Chromium, esbuild (runtime bundle), zod, vitest; anime.js (MIT), D3 (ISC), lottie-web (MIT), CodeMirror 6 (MIT).

**Spec:** `docs/superpowers/specs/2026-10-10-html-scenes-design.md`

## Global Constraints

- Iframe is `sandbox="allow-scripts"` and nothing else — never `allow-same-origin`, `allow-popups`, `allow-forms`, `allow-top-navigation`, `allow-modals`.
- Scene CSP: `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' <scene> <base>/__talkie/; style-src 'unsafe-inline' <scene> data:; img-src <scene> data: blob:; font-src <scene> data:; media-src <scene> data: blob:; connect-src 'none'; frame-src 'none'; worker-src blob:; object-src 'none'; form-action 'none'; base-uri 'none'`.
- Editor CSP `frame-src` becomes exactly `http://127.0.0.1:*`; nothing wider.
- Allowed scene files: `.html .css .js .mjs .json .svg .png .jpg .jpeg .webp .gif .woff2 .woff .ttf .otf .txt`; ≤ 50 MB and ≤ 500 files per scene; paths must stay inside the folder.
- A frame not drawn within **5 s** is captured anyway and the error recorded.
- Poster at **40%** of the scene's duration.
- Libraries: anime.js, D3, lottie-web only. **No GSAP.**
- Theme CSS variables: `--talkie-bg --talkie-heading --talkie-body --talkie-accent --talkie-font-heading --talkie-font-body --talkie-logo`.
- Every MCP verb (create, read, modify, remove, place) exists; HTML tools join `AGENT_TOOLS`.
- IPC channels are `project:*` / `settings:*`, each with a handler and a caller (`channelCoverage.test.ts`).
- Main/preload stay CJS; resources resolve from `__dirname`, never `process.cwd()`.
- British spelling; comments say why; tests describe behaviour. `npm test` and `npm run typecheck` pass before each commit.

**Deviation from spec, deliberate:** the spec says history snapshots the scene folder. History is synchronous and JSON-only, so instead every save writes a **new revision folder** and the clip points at it — undo restores the pointer, the old folder is still there. Unreferenced revisions are swept when a project opens (history is empty then). The spec is updated in Task 1.

---

## File map

| File | Responsibility |
|---|---|
| `src/main/project/timeline/schema.ts` | `HtmlSceneDataSchema`, `html` kind |
| `src/main/htmlScene/store.ts` | Revision folders: write, read, import, limits, sweep |
| `src/main/htmlScene/cdn.ts` | Rewrite CDN copies of bundled libraries; list other remote refs |
| `src/main/htmlScene/policy.ts` | Scene CSP string; runtime injection into HTML |
| `src/main/htmlScene/resources.ts` | Where the runtime, host, libraries and templates are; builds on demand in a checkout |
| `scripts/bundleHtmlScene.mjs` | Build `out/html-scene/` |
| `src/htmlScene/protocol.ts` | Message types shared by runtime and hosts |
| `src/htmlScene/runtime/*.ts` | The in-page runtime: clock, animations, theme, API |
| `src/htmlScene/host/host.ts` | The headless host page used by the check |
| `src/main/render/assetServer.ts` | `__talkie/` route; CSP + injection for scene pages; `posterUrl` |
| `src/main/security/contentSecurityPolicy.ts` | `frame-src` |
| `src/composition/items/HtmlScene.tsx` | The iframe host in preview and export |
| `src/main/htmlScene/check.ts` | `checkHtmlScene`: frames, problems, poster, visible text |
| `src/main/htmlScene/htmlSceneApi.ts` | Add / edit / read scenes; posters; stale posters |
| `src/main/htmlScene/guide.ts` | The authoring guide (MCP tool + AI prompt) |
| `src/main/htmlScene/writeHtmlScene.ts` | AI: describe → files; change → files |
| `resources/html-templates/*/index.html` | Six templates |
| `src/main/ipc/htmlSceneHandlers.ts`, preload, client | IPC |
| `src/renderer/src/components/htmlScene/*` | Editor, code panel, values form, add dialog |
| `src/main/agent/clipEvidence.ts` | Drafting reads an HTML scene |
| `src/mcp/server.ts`, `src/main/agent/projectAgent.ts` | MCP tools |

---

### Task 1: The `html` kind and revision folders

**Files:**
- Modify: `src/main/project/timeline/schema.ts`
- Create: `src/main/htmlScene/store.ts`, `src/main/htmlScene/store.test.ts`
- Modify: `docs/superpowers/specs/2026-10-10-html-scenes-design.md` (section 1: revisions instead of folder snapshots)

**Interfaces:**
- Produces:
  - `HtmlSceneDataSchema` = `{ src: string; title: string; style: { theme: 'brand'|'light'|'dark' } (default dark); params: Record<string, unknown> (default {}); prompt?: string; posterStamp?: string; posterText?: string; check?: { problems: string[] } }`, `type HtmlSceneData`
  - `SCENE_FILE_TYPES: Set<string>`, `MAX_SCENE_BYTES = 50*1024*1024`, `MAX_SCENE_FILES = 500`
  - `writeRevision(projectId: string, files: Record<string, string | Buffer>, opts?: { from?: string; remove?: string[]; baseDir?: string }): string` — returns absolute entry path (`.../index.html` or the single `.html` given)
  - `readRevision(entryPath: string): { path: string; text?: string; bytes: number }[]` (text for text types)
  - `sweepUnusedRevisions(projectId: string, baseDir?: string): number`
  - `sceneDirOf(entryPath: string): string`

- [ ] **Step 1: Write failing tests** (`store.test.ts`)

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { createProject, addTimelineItem, readTimeline } from '../project/projectApi'
import { readRevision, sweepUnusedRevisions, writeRevision } from './store'
import { TimelineItemSchema } from '../project/timeline/schema'

let baseDir: string
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'talkie-html-')) })
afterEach(() => rmSync(baseDir, { recursive: true, force: true }))

describe('a scene’s files', () => {
  it('are kept in a folder of their own, and a change makes a new one', () => {
    const { id } = createProject('Demo', baseDir)
    const first = writeRevision(id, { 'index.html': '<h1>One</h1>' }, { baseDir })
    const second = writeRevision(id, { 'index.html': '<h1>Two</h1>' }, { from: first, baseDir })

    expect(dirname(first)).not.toBe(dirname(second))
    expect(readFileSync(first, 'utf-8')).toBe('<h1>One</h1>')
    expect(readFileSync(second, 'utf-8')).toBe('<h1>Two</h1>')
  })

  it('carry over what was not changed, and drop what was removed', () => {
    const { id } = createProject('Demo', baseDir)
    const first = writeRevision(id, { 'index.html': 'x', 'style.css': 'h1{}', 'old.js': '1' }, { baseDir })
    const second = writeRevision(id, { 'index.html': 'y' }, { from: first, remove: ['old.js'], baseDir })

    expect(readRevision(second).map((f) => f.path).sort()).toEqual(['index.html', 'style.css'])
  })

  it('refuse a path that leaves the folder, a type that is not allowed, and too many bytes', () => {
    const { id } = createProject('Demo', baseDir)
    expect(() => writeRevision(id, { '../escape.html': 'x' }, { baseDir })).toThrow(/outside/)
    expect(() => writeRevision(id, { 'index.html': 'x', 'run.sh': 'x' }, { baseDir })).toThrow(/\.sh/)
    expect(() => writeRevision(id, { 'index.html': Buffer.alloc(51 * 1024 * 1024) }, { baseDir })).toThrow(/50 MB/)
  })

  it('need a page to start from', () => {
    const { id } = createProject('Demo', baseDir)
    expect(() => writeRevision(id, { 'style.css': 'h1{}' }, { baseDir })).toThrow(/index\.html/)
  })

  it('are a clip the timeline accepts', () => {
    const { id } = createProject('Demo', baseDir)
    const src = writeRevision(id, { 'index.html': '<p>hi</p>' }, { baseDir })
    expect(TimelineItemSchema.safeParse({ id: 'a', kind: 'html', start: 0, duration: 150, data: { src, title: 'Hi' } }).success).toBe(true)
  })

  it('are swept once nothing points at them', () => {
    const { id } = createProject('Demo', baseDir)
    const kept = writeRevision(id, { 'index.html': 'kept' }, { baseDir })
    const dropped = writeRevision(id, { 'index.html': 'dropped' }, { baseDir })
    addTimelineItem(id, { kind: 'html', start: 0, duration: 150, data: { src: kept, title: 'K' } }, baseDir)

    expect(sweepUnusedRevisions(id, baseDir)).toBe(1)
    expect(existsSync(kept)).toBe(true)
    expect(existsSync(dropped)).toBe(false)
    expect(readTimeline(id, baseDir)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run, expect failure** — `npx vitest run src/main/htmlScene/store.test.ts` → FAIL (module not found).

- [ ] **Step 3: Schema** — in `schema.ts`, after `DiagramSceneDataSchema`:

```ts
/**
 * A scene drawn by a web page. `src` is the page itself, an absolute path like every other clip's
 * media, inside a revision folder that is never changed once written — see htmlScene/store.ts.
 */
export const HtmlSceneDataSchema = z.object({
  src: z.string(),
  title: z.string(),
  style: z.object({ theme: z.enum(['brand', 'light', 'dark']).default('dark') }).default({}),
  params: z.record(z.unknown()).default({}),
  prompt: z.string().optional(),
  /** What the poster was drawn for — files, theme and variant — so a stale one is redrawn. */
  posterStamp: z.string().optional(),
  /** The words on the poster frame, for the narration drafter. */
  posterText: z.string().optional(),
  check: z.object({ problems: z.array(z.string()) }).optional()
})
export type HtmlSceneData = z.infer<typeof HtmlSceneDataSchema>
```

and add `html: HtmlSceneDataSchema` to `TIMELINE_ITEM_DATA_SCHEMAS`.

- [ ] **Step 4: Store** (`store.ts`)

```ts
import { randomUUID } from 'crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, extname, join, normalize, relative, sep } from 'path'
import { findProjectDir } from '../project/paths'
import { readTimelineLenient } from '../project/projectApi'

/**
 * An HTML scene's files, one folder per revision.
 *
 * A folder is never changed once written: a save writes a new one and the clip points at it. Undo
 * restores the timeline, and so the pointer, and the old folder is still there to point at —
 * history stays two JSON files. Folders nothing points at are swept when the project opens, which
 * is the one moment no undo can reach them.
 */
export const SCENE_FILE_TYPES = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.woff2', '.woff', '.ttf', '.otf', '.txt'])
export const TEXT_TYPES = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt'])
export const MAX_SCENE_BYTES = 50 * 1024 * 1024
export const MAX_SCENE_FILES = 500

function scenesRoot(projectId: string, baseDir: string): string {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) throw new Error(`No project found with id ${projectId}`)
  return join(dir, 'sources', 'html')
}

export function sceneDirOf(entryPath: string): string {
  return dirname(entryPath)
}

/** A relative path inside the folder, or a refusal that says why. */
function checkedPath(path: string): string {
  const clean = normalize(path).replace(/^[/\\]+/, '')
  if (clean.startsWith('..') || clean.includes(`${sep}..${sep}`)) throw new Error(`"${path}" is outside the scene's folder.`)
  const type = extname(clean).toLowerCase()
  if (!SCENE_FILE_TYPES.has(type)) throw new Error(`A scene cannot hold ${type || 'files without a type'} ("${path}").`)
  return clean
}

function listFiles(dir: string, under = ''): string[] {
  return readdirSync(join(dir, under), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(dir, join(under, entry.name)) : [join(under, entry.name)]
  )
}

export function writeRevision(
  projectId: string,
  files: Record<string, string | Buffer>,
  opts: { from?: string; remove?: string[]; baseDir?: string } = {}
): string {
  const baseDir = opts.baseDir ?? homedir()
  const dir = join(scenesRoot(projectId, baseDir), randomUUID())
  mkdirSync(dir, { recursive: true })
  try {
    const removed = new Set((opts.remove ?? []).map(checkedPath))
    let entry: string | undefined
    if (opts.from) {
      const previous = sceneDirOf(opts.from)
      entry = relative(previous, opts.from)
      for (const file of listFiles(previous)) {
        if (removed.has(file) || file === 'poster.png' || file in files) continue
        mkdirSync(dirname(join(dir, file)), { recursive: true })
        cpSync(join(previous, file), join(dir, file))
      }
    }
    for (const [path, contents] of Object.entries(files)) {
      const clean = checkedPath(path)
      mkdirSync(dirname(join(dir, clean)), { recursive: true })
      writeFileSync(join(dir, clean), contents)
    }

    const written = listFiles(dir)
    if (written.length > MAX_SCENE_FILES) throw new Error(`A scene can hold at most ${MAX_SCENE_FILES} files.`)
    const bytes = written.reduce((sum, file) => sum + statSync(join(dir, file)).size, 0)
    if (bytes > MAX_SCENE_BYTES) throw new Error('A scene can hold at most 50 MB.')

    const pages = written.filter((file) => extname(file).toLowerCase() === '.html')
    entry = entry && written.includes(entry) ? entry : pages.includes('index.html') ? 'index.html' : pages.length === 1 ? pages[0] : undefined
    if (!entry) throw new Error('A scene needs an index.html to start from.')
    return join(dir, entry)
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

export function readRevision(entryPath: string): { path: string; text?: string; bytes: number }[] {
  const dir = sceneDirOf(entryPath)
  return listFiles(dir)
    .filter((file) => file !== 'poster.png')
    .sort()
    .map((file) => {
      const full = join(dir, file)
      const bytes = statSync(full).size
      return TEXT_TYPES.has(extname(file).toLowerCase()) ? { path: file, text: readFileSync(full, 'utf-8'), bytes } : { path: file, bytes }
    })
}

export function sweepUnusedRevisions(projectId: string, baseDir: string = homedir()): number {
  const root = scenesRoot(projectId, baseDir)
  if (!existsSync(root)) return 0
  const used = new Set(
    readTimelineLenient(projectId, baseDir)
      .filter((item) => item.kind === 'html')
      .map((item) => sceneDirOf((item.data as { src: string }).src))
  )
  let swept = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !used.has(join(root, entry.name))) {
      rmSync(join(root, entry.name), { recursive: true, force: true })
      swept++
    }
  }
  return swept
}
```

- [ ] **Step 5: Run tests** → PASS. Run `npm run typecheck`.

- [ ] **Step 6: Update spec section 1** — replace "History snapshots the scene folder with the timeline, so…" with: "Every save writes a new revision folder (`sources/html/<revisionId>/`) and the clip's `src` points into it. Undo restores the pointer; unreferenced revisions are swept when the project opens." and replace `dir`/`entry` in the data block with `src: string // absolute path of the entry page`.

- [ ] **Step 7: Commit** — `git add -A src/main/htmlScene src/main/project/timeline/schema.ts docs/superpowers/specs && git commit -m "Keep an HTML scene's files in revision folders, and accept it on the timeline"`

---

### Task 2: Import, with CDN rewriting

**Files:**
- Create: `src/main/htmlScene/cdn.ts`, `src/main/htmlScene/import.ts`, `src/main/htmlScene/import.test.ts`

**Interfaces:**
- Consumes: `writeRevision`, `SCENE_FILE_TYPES`, `MAX_SCENE_BYTES`, `MAX_SCENE_FILES`
- Produces:
  - `BUNDLED_LIBRARIES: { name: 'anime' | 'd3' | 'lottie'; file: string; pattern: RegExp }[]` (file = `anime.min.js` | `d3.min.js` | `lottie.min.js`)
  - `rewriteBundledCdns(html: string, libraryBase: string): { html: string; remote: string[] }` — `libraryBase` is a placeholder token `__TALKIE_LIB__/` resolved by the asset server at serve time
  - `importScene(projectId: string, sourcePath: string, baseDir?: string): { src: string; warnings: string[] }`

- [ ] **Step 1: Failing tests** (`import.test.ts`)

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../project/projectApi'
import { importScene } from './import'
import { rewriteBundledCdns } from './cdn'
import { readRevision } from './store'

let baseDir: string
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'talkie-html-import-')) })
afterEach(() => rmSync(baseDir, { recursive: true, force: true }))

describe('a page brought in from elsewhere', () => {
  it('uses Talkie’s own copy of a library it loaded from a CDN', () => {
    const { html, remote } = rewriteBundledCdns(
      '<script src="https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js"></script><script src="https://d3js.org/d3.v7.min.js"></script>',
      '__TALKIE_LIB__/'
    )
    expect(html).toContain('src="__TALKIE_LIB__/anime.min.js"')
    expect(html).toContain('src="__TALKIE_LIB__/d3.min.js"')
    expect(remote).toEqual([])
  })

  it('names anything else it loads from the internet, since that cannot load', () => {
    const { remote } = rewriteBundledCdns(
      '<script src="https://cdn.example.com/chart.js"></script><link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter"><img src="//images.example.com/a.png">',
      '__TALKIE_LIB__/'
    )
    expect(remote).toEqual(['https://cdn.example.com/chart.js', 'https://fonts.googleapis.com/css?family=Inter', '//images.example.com/a.png'])
  })

  it('brings a folder in with its images, and leaves out what a scene cannot hold', () => {
    const { id } = createProject('Demo', baseDir)
    const folder = join(baseDir, 'page')
    mkdirSync(join(folder, 'img'), { recursive: true })
    writeFileSync(join(folder, 'index.html'), '<img src="img/a.png">')
    writeFileSync(join(folder, 'img', 'a.png'), 'png')
    writeFileSync(join(folder, 'notes.docx'), 'x')

    const { src, warnings } = importScene(id, folder, baseDir)

    expect(readRevision(src).map((f) => f.path).sort()).toEqual(['img/a.png', 'index.html'])
    expect(warnings.join(' ')).toMatch(/notes\.docx/)
  })

  it('brings a single page in on its own', () => {
    const { id } = createProject('Demo', baseDir)
    const page = join(baseDir, 'chart.html')
    writeFileSync(page, '<script src="https://unpkg.com/lottie-web@5.12.2/build/player/lottie.min.js"></script>')

    const { src } = importScene(id, page, baseDir)

    expect(readFileSync(src, 'utf-8')).toContain('__TALKIE_LIB__/lottie.min.js')
  })
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: `cdn.ts`**

```ts
/**
 * Pages written for the web load their libraries from CDNs, and a scene cannot reach the network.
 * Where the library is one Talkie ships, the tag is pointed at Talkie's copy instead; anything else
 * remote is named, so whoever imported the page knows what will not load.
 */
export const BUNDLED_LIBRARIES = [
  { name: 'anime', file: 'anime.min.js', pattern: /\banime(?:js)?(?:@[\w.-]+)?\/.*anime(?:\.min)?\.js|\banime(?:\.min)?\.js$/i },
  { name: 'd3', file: 'd3.min.js', pattern: /\bd3(?:@[\w.-]+)?\/.*d3(?:\.min)?\.js|d3js\.org\/d3(?:\.v\d+)?(?:\.min)?\.js|\/d3(?:\.min)?\.js$/i },
  { name: 'lottie', file: 'lottie.min.js', pattern: /lottie(?:-web)?(?:@[\w.-]+)?\/.*lottie(?:_\w+)?(?:\.min)?\.js|\/lottie(?:\.min)?\.js$/i }
] as const

const REMOTE = /\b(src|href)\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi

export function rewriteBundledCdns(html: string, libraryBase: string): { html: string; remote: string[] } {
  const remote: string[] = []
  const rewritten = html.replace(REMOTE, (whole, attribute: string, url: string) => {
    const library = attribute.toLowerCase() === 'src' ? BUNDLED_LIBRARIES.find((lib) => lib.pattern.test(url)) : undefined
    if (library) return `${attribute}="${libraryBase}${library.file}"`
    // A link to somewhere is not a load; only what the page fetches counts.
    if (/^<a\b/i.test(html.slice(Math.max(0, html.lastIndexOf('<', html.indexOf(whole))), html.indexOf(whole)))) return whole
    remote.push(url)
    return whole
  })
  return { html: rewritten, remote }
}
```

- [ ] **Step 4: `import.ts`**

```ts
import { readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, extname, join, relative } from 'path'
import { rewriteBundledCdns } from './cdn'
import { MAX_SCENE_BYTES, MAX_SCENE_FILES, SCENE_FILE_TYPES, writeRevision } from './store'

export const LIBRARY_TOKEN = '__TALKIE_LIB__/'

/** A page or a folder, copied in as a scene. What a scene cannot hold is left behind and named. */
export function importScene(projectId: string, sourcePath: string, baseDir: string = homedir()): { src: string; warnings: string[] } {
  const warnings: string[] = []
  const files: Record<string, string | Buffer> = {}
  const isFolder = statSync(sourcePath).isDirectory()
  const paths = isFolder ? walk(sourcePath) : [sourcePath]
  if (paths.length > MAX_SCENE_FILES * 2) throw new Error(`That folder has ${paths.length} files; a scene can hold ${MAX_SCENE_FILES}.`)

  let total = 0
  for (const path of paths) {
    const name = isFolder ? relative(sourcePath, path) : basename(path)
    if (!SCENE_FILE_TYPES.has(extname(name).toLowerCase())) {
      warnings.push(`Left out ${name}: a scene cannot hold ${extname(name) || 'that kind of file'}.`)
      continue
    }
    total += statSync(path).size
    if (total > MAX_SCENE_BYTES) throw new Error('That is more than the 50 MB a scene can hold.')
    if (extname(name).toLowerCase() === '.html') {
      const { html, remote } = rewriteBundledCdns(readFileSync(path, 'utf-8'), LIBRARY_TOKEN)
      for (const url of remote) warnings.push(`${name} loads ${url} from the internet, which a scene cannot do.`)
      files[name] = html
    } else {
      files[name] = readFileSync(path)
    }
  }
  if (!isFolder && extname(sourcePath).toLowerCase() !== '.html') throw new Error('Import an .html page, or a folder with one in it.')
  // A single page keeps working under the name a scene starts from.
  if (!isFolder) {
    const [only] = Object.keys(files)
    files['index.html'] = files[only]
    if (only !== 'index.html') delete files[only]
  }
  return { src: writeRevision(projectId, files, { baseDir }), warnings }
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.name.startsWith('.') ? [] : entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )
}
```

- [ ] **Step 5: Run** → PASS; typecheck.
- [ ] **Step 6: Commit** — `git commit -m "Import a page or folder as an HTML scene, swapping CDN libraries for Talkie's own"`

---

### Task 3: The runtime and the message protocol

**Files:**
- Create: `src/htmlScene/protocol.ts`, `src/htmlScene/runtime/clock.ts`, `src/htmlScene/runtime/animations.ts`, `src/htmlScene/runtime/theme.ts`, `src/htmlScene/runtime/index.ts`, `src/htmlScene/runtime/clock.test.ts`
- Modify: `vitest.config.ts` (include `src/htmlScene/**/*.test.ts`), `tsconfig.web.json` (include `src/htmlScene/**`)

**Interfaces:**
- Produces (`protocol.ts`):

```ts
export interface SceneTheme {
  background: string; heading: string; body: string; accent: string
  fonts: { heading: { family: string; urls: string[] }; body: { family: string; urls: string[] } }
  logo?: string
}
export interface InitMessage { type: 'talkie:init'; fps: number; durationFrames: number; width: number; height: number; params: Record<string, unknown>; theme: SceneTheme | null; beats: number[] }
export interface SeekMessage { type: 'talkie:seek'; frame: number; id: number }
export interface ThemeMessage { type: 'talkie:theme'; theme: SceneTheme | null }
export type HostMessage = InitMessage | SeekMessage | ThemeMessage
export type SceneMessage =
  | { type: 'talkie:ready' }
  | { type: 'talkie:drawn'; id: number }
  | { type: 'talkie:error'; message: string; line?: number }
export const DRAW_TIMEOUT_MS = 5000
export function isSceneMessage(value: unknown): value is SceneMessage
```

- Runtime exposes `window.talkie` per spec section 3.
- `createClock()` from `clock.ts`: `{ now(): number; install(target: Window): void; advanceTo(ms: number): void }` — `advanceTo` runs due timers in order then queued rAF callbacks with the timestamp.

- [ ] **Step 1: Failing clock tests** (`clock.test.ts`, node env — the clock takes a target object)

```ts
import { describe, expect, it } from 'vitest'
import { createClock } from './runtime/clock'

function fakeWindow(): any {
  return { requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, setTimeout, clearTimeout, setInterval, clearInterval, performance: { now: () => 0 }, Date }
}

describe('a scene’s clock', () => {
  it('tells the video’s time, not the wall’s', () => {
    const win = fakeWindow(); const clock = createClock(); clock.install(win)
    clock.advanceTo(4000)
    expect(win.performance.now()).toBe(4000)
    expect(win.Date.now() - clock.epoch).toBe(4000)
  })

  it('runs timers when the video reaches them, in order, and repeats intervals', () => {
    const win = fakeWindow(); const clock = createClock(); clock.install(win)
    const seen: string[] = []
    win.setTimeout(() => seen.push('b'), 200)
    win.setTimeout(() => seen.push('a'), 100)
    win.setInterval(() => seen.push('i'), 150)
    clock.advanceTo(320)
    expect(seen).toEqual(['a', 'i', 'b', 'i'])
  })

  it('draws animation frames with the video’s timestamp', () => {
    const win = fakeWindow(); const clock = createClock(); clock.install(win)
    const stamps: number[] = []
    const loop = (t: number): void => { stamps.push(t); win.requestAnimationFrame(loop) }
    win.requestAnimationFrame(loop)
    clock.advanceTo(1000 / 30)
    clock.advanceTo(2000 / 30)
    expect(stamps).toEqual([1000 / 30, 2000 / 30])
  })

  it('lands time-based motion on the same place whichever frame came before', () => {
    const run = (frames: number[]): number => {
      const win = fakeWindow(); const clock = createClock(); clock.install(win)
      let x = 0
      const loop = (t: number): void => { x = (t / 1000) * 100; win.requestAnimationFrame(loop) }
      win.requestAnimationFrame(loop)
      for (const f of frames) clock.advanceTo((f * 1000) / 30)
      return x
    }
    expect(run([120])).toBe(run([0, 60, 119, 120]))
  })
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: `clock.ts`**

```ts
/**
 * Video time for a page that was written against the wall clock.
 *
 * The export draws frames out of order across several tabs, so anything a page times by the real
 * clock lands somewhere different in every frame. Inside a scene, the clock is this one: it only
 * moves when the video says where it is, and everything that reads or waits on time reads it.
 */
interface Timer { id: number; at: number; every?: number; fn: () => void }

export function createClock(): { epoch: number; now(): number; install(target: any): void; advanceTo(ms: number): void } {
  const epoch = Date.UTC(2026, 0, 1)
  let now = 0
  let nextId = 1
  let timers: Timer[] = []
  let frameCallbacks = new Map<number, (t: number) => void>()

  return {
    epoch,
    now: () => now,
    install(target) {
      const RealDate = target.Date
      class VideoDate extends RealDate {
        constructor(...args: any[]) { super(...((args.length ? args : [epoch + now]) as [])) }
        static now(): number { return epoch + now }
      }
      target.Date = VideoDate
      target.performance = Object.assign(Object.create(target.performance ?? {}), { now: () => now })
      target.setTimeout = (fn: () => void, ms = 0) => { const id = nextId++; timers.push({ id, at: now + Math.max(0, ms), fn }); return id }
      target.setInterval = (fn: () => void, ms = 0) => { const id = nextId++; const every = Math.max(1, ms); timers.push({ id, at: now + every, every, fn }); return id }
      target.clearTimeout = target.clearInterval = (id: number) => { timers = timers.filter((t) => t.id !== id) }
      target.requestAnimationFrame = (fn: (t: number) => void) => { const id = nextId++; frameCallbacks.set(id, fn); return id }
      target.cancelAnimationFrame = (id: number) => { frameCallbacks.delete(id) }
    },
    advanceTo(ms) {
      // Backwards is a fresh look at an earlier moment: timers set for later stay where they are.
      for (;;) {
        const due = timers.filter((t) => t.at <= ms).sort((a, b) => a.at - b.at || a.id - b.id)[0]
        if (!due) break
        now = Math.max(now, due.at)
        if (due.every) due.at += due.every
        else timers = timers.filter((t) => t !== due)
        due.fn()
      }
      now = ms
      const callbacks = frameCallbacks
      frameCallbacks = new Map()
      for (const fn of callbacks.values()) fn(ms)
    }
  }
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: `animations.ts`, `theme.ts`, `index.ts`, `protocol.ts`** (no unit tests here — they need a real browser; Task 6's tests drive them)

`protocol.ts`: the interfaces above plus

```ts
export function isSceneMessage(value: unknown): value is SceneMessage {
  const type = (value as { type?: unknown } | null)?.type
  return type === 'talkie:ready' || type === 'talkie:drawn' || type === 'talkie:error'
}
```

`animations.ts`:

```ts
/** Library animations handed over with talkie.anime() / talkie.lottie(), seeked by time. */
const anime: Array<{ seek(ms: number): void; pause?(): void }> = []
const lotties: Array<{ goToAndStop(value: number, isFrame?: boolean): void; frameRate?: number }> = []

export function registerAnime(timeline: { seek(ms: number): void; pause?(): void }): void { timeline.pause?.(); anime.push(timeline) }
export function registerLottie(animation: { goToAndStop(value: number, isFrame?: boolean): void }): void { lotties.push(animation) }

/** Every CSS animation, transition and Web Animation on the page, held at this moment. */
export function settleAnimations(doc: Document, ms: number): void {
  for (const animation of doc.getAnimations()) {
    animation.pause()
    animation.currentTime = ms
  }
  for (const timeline of anime) timeline.seek(ms)
  for (const animation of lotties) animation.goToAndStop(ms, false)
}
```

Note: CSS animation `currentTime` counts from the animation's start, which for a document-timeline animation created at load is time 0 — the scene's start — so `ms` is right for both CSS and Web Animations created at load. Animations created later (by `onFrame`) start at the moment they were made; set them with `element.animate(...)` inside `onFrame` and they are held at `ms - createdAt` by the browser's own bookkeeping once paused at creation — documented in the guide (Task 9) as "create animations at load, or drive them yourself in onFrame".

`theme.ts`:

```ts
import type { SceneTheme } from '../protocol'

/** The theme as CSS variables and loaded faces, so a scene written against them follows any theme. */
export async function applyTheme(doc: Document, theme: SceneTheme | null): Promise<void> {
  const root = doc.documentElement.style
  if (!theme) return
  root.setProperty('--talkie-bg', theme.background)
  root.setProperty('--talkie-heading', theme.heading)
  root.setProperty('--talkie-body', theme.body)
  root.setProperty('--talkie-accent', theme.accent)
  root.setProperty('--talkie-font-heading', `"${theme.fonts.heading.family}", ui-serif, Georgia, serif`)
  root.setProperty('--talkie-font-body', `"${theme.fonts.body.family}", ui-sans-serif, system-ui, sans-serif`)
  root.setProperty('--talkie-logo', theme.logo ? `url("${theme.logo}")` : 'none')
  const faces = [theme.fonts.heading, theme.fonts.body].flatMap(({ family, urls }) =>
    urls.map((url) => {
      const weight = /;name=[^;]*-(\d{3})/.exec(url)?.[1] ?? '400'
      return new FontFace(family, `url("${url}")`, { weight })
    })
  )
  for (const face of faces) {
    try { doc.fonts.add(await face.load()) } catch { /* a face that will not load falls back to the stack */ }
  }
}
```

`index.ts` (the runtime entry; bundled as an IIFE):

```ts
import { createClock } from './clock'
import { registerAnime, registerLottie, settleAnimations } from './animations'
import { applyTheme } from './theme'
import type { HostMessage, InitMessage, SceneMessage, SceneTheme } from '../protocol'

const realRaf = window.requestAnimationFrame.bind(window)
const clock = createClock()
clock.install(window)

const handlers: Array<(t: number) => unknown> = []
const waits: Promise<unknown>[] = []
let init: InitMessage | null = null
let resolveInit: () => void
const initialised = new Promise<void>((resolve) => { resolveInit = resolve })

const send = (message: SceneMessage): void => window.parent.postMessage(message, '*')

const talkie = {
  time: 0, frame: 0, duration: 0, fps: 30,
  params: {} as Record<string, unknown>,
  theme: null as SceneTheme | null,
  beats: [] as number[],
  onFrame(fn: (t: number) => unknown): void { handlers.push(fn) },
  ready(promise: Promise<unknown>): void { waits.push(promise) },
  anime: registerAnime,
  lottie: registerLottie
}
Object.defineProperty(window, 'talkie', { value: talkie })

window.addEventListener('error', (event) => send({ type: 'talkie:error', message: event.message, line: event.lineno }))
window.addEventListener('unhandledrejection', (event) => send({ type: 'talkie:error', message: String((event.reason as Error)?.message ?? event.reason) }))
document.addEventListener('securitypolicyviolation', (event) =>
  send({ type: 'talkie:error', message: `Blocked: ${event.violatedDirective} ${event.blockedURI || ''}`.trim() })
)

/** One real paint, so the picture captured is the one just drawn. */
const painted = (): Promise<void> => new Promise((resolve) => realRaf(() => realRaf(() => resolve())))

async function seek(frame: number): Promise<void> {
  await initialised
  await Promise.allSettled(waits)
  const ms = (frame * 1000) / talkie.fps
  Object.assign(talkie, { frame, time: ms / 1000 })
  clock.advanceTo(ms)
  for (const handler of handlers) await handler(talkie.time)
  settleAnimations(document, ms)
  await document.fonts.ready
  await Promise.all(Array.from(document.images).filter((img) => !img.complete).map((img) => img.decode().catch(() => undefined)))
  await painted()
}

let queue = Promise.resolve()
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  const message = event.data as HostMessage
  if (message?.type === 'talkie:init') {
    init = message
    Object.assign(talkie, { fps: message.fps, duration: message.durationFrames / message.fps, params: message.params, theme: message.theme, beats: message.beats })
    void applyTheme(document, message.theme).then(() => resolveInit())
  } else if (message?.type === 'talkie:theme') {
    talkie.theme = message.theme
    void applyTheme(document, message.theme)
  } else if (message?.type === 'talkie:seek') {
    // In order: a seek waits for the one before it, so replies come back in the order asked.
    queue = queue.then(() => seek(message.frame)).then(
      () => send({ type: 'talkie:drawn', id: message.id }),
      (err) => { send({ type: 'talkie:error', message: String((err as Error)?.message ?? err) }); send({ type: 'talkie:drawn', id: message.id }) }
    )
  }
})

window.addEventListener('load', () => send({ type: 'talkie:ready' }))
void init
```

- [ ] **Step 6:** add `'src/htmlScene/**/*.test.ts'` to `vitest.config.ts` include; add `"src/htmlScene/**/*"` to `tsconfig.web.json` include. Run `npm run typecheck` and the clock tests.
- [ ] **Step 7: Commit** — `git commit -m "Add the HTML scene runtime: video time, held animations, theme variables"`

---

### Task 4: Building and finding the runtime, host, libraries and templates

**Files:**
- Create: `scripts/bundleHtmlScene.mjs`, `src/main/htmlScene/resources.ts`, `src/main/htmlScene/resources.test.ts`, `src/htmlScene/host/host.ts`, `src/htmlScene/host/host.html`
- Modify: `package.json` (deps `animejs@^3.2.2`, `d3@^7`, `lottie-web@^5.12`; script `build:htmlscene`; `build` runs it), `electron-builder.yml` (`asarUnpack: out/html-scene/**`)

**Interfaces:**
- Produces: `htmlSceneResource(name: string): { path: string; type: string } | null` for `runtime.js`, `host.js`, `host.html`, `lib/anime.min.js`, `lib/d3.min.js`, `lib/lottie.min.js`; `templatesDir(): string`.
- Host page protocol (used by Task 6 via `page.evaluate`): `window.talkieHost = { load(url: string, init: Omit<InitMessage,'type'>): Promise<void>; seek(frame: number): Promise<void>; errors: string[] }`.

- [ ] **Step 1:** `npm install animejs@^3.2.2 d3@^7.9.0 lottie-web@^5.12.2` (all go in `dependencies`: they are served to scenes at runtime).

- [ ] **Step 2: Failing test** (`resources.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { htmlSceneResource, templatesDir } from './resources'
import { existsSync } from 'fs'
import { join } from 'path'

describe('what a scene is served besides its own files', () => {
  it('has the runtime, the host and the three bundled libraries, from a checkout too', () => {
    for (const name of ['runtime.js', 'host.js', 'host.html', 'lib/anime.min.js', 'lib/d3.min.js', 'lib/lottie.min.js']) {
      const found = htmlSceneResource(name)
      expect(found, name).not.toBeNull()
      expect(readFileSync(found!.path).length, name).toBeGreaterThan(100)
    }
    expect(readFileSync(htmlSceneResource('runtime.js')!.path, 'utf-8')).toContain('talkie:seek')
  })

  it('has nothing else', () => {
    expect(htmlSceneResource('../package.json')).toBeNull()
    expect(htmlSceneResource('lib/gsap.min.js')).toBeNull()
  })

  it('has the templates', () => {
    expect(existsSync(join(templatesDir(), 'bar-chart', 'index.html'))).toBe(true)
  })
})
```

- [ ] **Step 3: `resources.ts`**

```ts
import { buildSync } from 'esbuild'
import { existsSync, mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'

/**
 * The runtime, the host page, the libraries and the templates, wherever this build keeps them.
 *
 * A build has them in out/html-scene, beside out/main and out/mcp, and unpacked from the archive
 * because the MCP server is plain node. A checkout running the tests has only the sources, so the
 * two scripts are built on first use and the libraries come from node_modules.
 */
const LIBRARIES: Record<string, string> = {
  'lib/anime.min.js': 'animejs/lib/anime.min.js',
  'lib/d3.min.js': 'd3/dist/d3.min.js',
  'lib/lottie.min.js': 'lottie-web/build/player/lottie.min.js'
}
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html' }

export function shippedDir(fromDir: string = __dirname): string {
  return join(fromDir.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`), '..', 'html-scene')
}

let built: string | null = null
function builtInCheckout(): string {
  if (built) return built
  const out = mkdtempSync(join(tmpdir(), 'talkie-html-scene-'))
  const root = join(__dirname, '..', '..', '..')
  for (const [entry, file] of [['src/htmlScene/runtime/index.ts', 'runtime.js'], ['src/htmlScene/host/host.ts', 'host.js']]) {
    buildSync({ entryPoints: [join(root, entry)], bundle: true, format: 'iife', target: 'chrome120', outfile: join(out, file) })
  }
  built = out
  return out
}

export function htmlSceneResource(name: string): { path: string; type: string } | null {
  const shipped = shippedDir()
  const fromShipped = existsSync(join(shipped, 'runtime.js'))
  const type = TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream'
  if (name === 'runtime.js' || name === 'host.js') {
    return { path: join(fromShipped ? shipped : builtInCheckout(), name), type }
  }
  if (name === 'host.html') {
    return { path: fromShipped ? join(shipped, name) : join(__dirname, '..', '..', 'htmlScene', 'host', 'host.html'), type }
  }
  if (name in LIBRARIES) {
    return { path: fromShipped ? join(shipped, name) : require.resolve(LIBRARIES[name]), type }
  }
  return null
}

export function templatesDir(): string {
  const shipped = join(shippedDir(), 'templates')
  return existsSync(shipped) ? shipped : join(__dirname, '..', '..', '..', 'resources', 'html-templates')
}
void mkdirSync
```

(Check `__dirname` depth in vitest: `src/main/htmlScene` → `../../..` is the repo root; `src/main/htmlScene/../../htmlScene/host/host.html` resolves to `src/htmlScene/host/host.html`.)

- [ ] **Step 4: Host** — `host.html`:

```html
<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}iframe{border:0;display:block}</style><body><script src="host.js"></script></body>
```

`host.ts`:

```ts
import { DRAW_TIMEOUT_MS, isSceneMessage, type InitMessage } from '../protocol'

/**
 * A page that holds one scene the way the video does, for the headless check: same sandbox, same
 * messages. Driven from Playwright through window.talkieHost.
 */
let frame: HTMLIFrameElement | null = null
let nextId = 1
const errors: string[] = []
const waiting = new Map<number, () => void>()
let ready: () => void = () => undefined

window.addEventListener('message', (event) => {
  if (!frame || event.source !== frame.contentWindow || !isSceneMessage(event.data)) return
  const message = event.data
  if (message.type === 'talkie:ready') ready()
  else if (message.type === 'talkie:error') errors.push(message.line ? `${message.message} (line ${message.line})` : message.message)
  else if (message.type === 'talkie:drawn') { waiting.get(message.id)?.(); waiting.delete(message.id) }
})

Object.defineProperty(window, 'talkieHost', {
  value: {
    errors,
    load(url: string, init: Omit<InitMessage, 'type'>): Promise<void> {
      frame?.remove()
      frame = document.createElement('iframe')
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.width = String(init.width)
      frame.height = String(init.height)
      const loaded = new Promise<void>((resolve, reject) => {
        ready = resolve
        setTimeout(() => reject(new Error('The scene did not finish loading.')), 15_000)
      })
      frame.src = url
      document.body.append(frame)
      return loaded.then(() => frame!.contentWindow!.postMessage({ type: 'talkie:init', ...init }, '*'))
    },
    seek(frameNumber: number): Promise<void> {
      const id = nextId++
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => { errors.push(`Frame ${frameNumber} was not drawn within 5 s.`); resolve() }, DRAW_TIMEOUT_MS)
        waiting.set(id, () => { clearTimeout(timer); resolve() })
        frame!.contentWindow!.postMessage({ type: 'talkie:seek', frame: frameNumber, id }, '*')
      })
    }
  }
})
```

- [ ] **Step 5: `scripts/bundleHtmlScene.mjs`**

```js
/**
 * Builds what HTML scenes are served besides their own files into out/html-scene: the runtime and
 * the headless host (esbuild, one file each), the three libraries Talkie offers scenes, and the
 * templates. Resolved at run time from __dirname — see src/main/htmlScene/resources.ts.
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'out/html-scene')
const require = createRequire(import.meta.url)
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'lib'), { recursive: true })

for (const [entry, file] of [['src/htmlScene/runtime/index.ts', 'runtime.js'], ['src/htmlScene/host/host.ts', 'host.js']]) {
  await build({ entryPoints: [join(root, entry)], bundle: true, format: 'iife', target: 'chrome120', minify: true, outfile: join(out, file) })
}
cpSync(join(root, 'src/htmlScene/host/host.html'), join(out, 'host.html'))
cpSync(require.resolve('animejs/lib/anime.min.js'), join(out, 'lib/anime.min.js'))
cpSync(require.resolve('d3/dist/d3.min.js'), join(out, 'lib/d3.min.js'))
cpSync(require.resolve('lottie-web/build/player/lottie.min.js'), join(out, 'lib/lottie.min.js'))
cpSync(join(root, 'resources/html-templates'), join(out, 'templates'), { recursive: true })
console.log(`HTML scene resources built into ${out}`)
```

`package.json` scripts: `"build:htmlscene": "node scripts/bundleHtmlScene.mjs"`, and `"build": "electron-vite build && npm run build:mcp && npm run build:htmlscene"`. `electron-builder.yml` `asarUnpack`: add `- out/html-scene/**` with the comment "The MCP server reads these as plain node, which cannot read inside the archive."

- [ ] **Step 6: One template so the test passes** — `resources/html-templates/bar-chart/index.html` (full template content in Task 9; for now a valid page using `talkie.onFrame`).

- [ ] **Step 7: Run tests** → PASS; `npm run build:htmlscene` succeeds; typecheck.
- [ ] **Step 8: Commit** — `git commit -m "Build and find the HTML scene runtime, host, libraries and templates"`

---

### Task 5: Serving scenes: the `__talkie/` route, injection and the scene policy

**Files:**
- Create: `src/main/htmlScene/policy.ts`, `src/main/htmlScene/policy.test.ts`
- Modify: `src/main/render/assetServer.ts`, `src/main/render/assetServer.test.ts` (or new `assetServer.htmlScene.test.ts`), `src/main/security/contentSecurityPolicy.ts` + its test

**Interfaces:**
- Consumes: `htmlSceneResource`, `LIBRARY_TOKEN`
- Produces: `scenePolicy(sceneFolderUrl: string, base: string): string`; `injectRuntime(html: string, base: string): string`; asset server serves `<base>/__talkie/<name>` and, for `.html` under `/sources/html/`, the injected page with `Content-Security-Policy`. `SRC_MEDIA_KINDS` includes `html`; `resolveTimelineAssetUrls` adds `posterUrl` for html items when `poster.png` exists (`?v=<posterStamp>`).

- [ ] **Step 1: Failing tests**

`policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { injectRuntime, scenePolicy } from './policy'

describe('a scene page as served', () => {
  it('runs Talkie’s runtime before anything of its own', () => {
    const out = injectRuntime('<html><head><script>own()</script></head><body></body></html>', 'http://127.0.0.1:1/s')
    expect(out.indexOf('__talkie/runtime.js')).toBeLessThan(out.indexOf('own()'))
  })
  it('gets a head if it had none, and Talkie’s libraries where it asked for them', () => {
    const out = injectRuntime('<p>hi</p><script src="__TALKIE_LIB__/d3.min.js"></script>', 'http://127.0.0.1:1/s')
    expect(out).toMatch(/^<head><script src="http:\/\/127\.0\.0\.1:1\/s\/__talkie\/runtime\.js"><\/script><\/head>/)
    expect(out).toContain('src="http://127.0.0.1:1/s/__talkie/lib/d3.min.js"')
  })
  it('may reach nothing but its own folder and Talkie’s', () => {
    const policy = scenePolicy('http://127.0.0.1:1/s/p/sources/html/r/', 'http://127.0.0.1:1/s')
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("img-src http://127.0.0.1:1/s/p/sources/html/r/ data: blob:")
    expect(policy).toContain("script-src 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:1/s/p/sources/html/r/ http://127.0.0.1:1/s/__talkie/")
    expect(policy).toContain("form-action 'none'")
  })
})
```

Asset server test (start a server on a temp root with a project containing `sources/html/r/index.html`, fetch it):

```ts
it('serves a scene page with the runtime in it and a policy of its own', async () => {
  // root/p/sources/html/r/index.html = '<p>hi</p>'
  const res = await fetch(`${server.url}/p/sources/html/r/index.html`)
  expect(res.headers.get('content-security-policy')).toContain("connect-src 'none'")
  expect(await res.text()).toContain('__talkie/runtime.js')
})
it('serves Talkie’s runtime and libraries, and nothing else under that name', async () => {
  expect((await fetch(`${server.url}/__talkie/runtime.js`)).status).toBe(200)
  expect((await fetch(`${server.url}/__talkie/lib/d3.min.js`)).status).toBe(200)
  expect((await fetch(`${server.url}/__talkie/../settings.json`)).status).not.toBe(200)
})
it('serves an HTML file that is not a scene as it is', async () => {
  // root/p/other.html
  const res = await fetch(`${server.url}/p/other.html`)
  expect(res.headers.get('content-security-policy')).toBeNull()
})
```

`contentSecurityPolicy.test.ts`: `expect(contentSecurityPolicy(false)).toContain('frame-src http://127.0.0.1:*')` and `expect(contentSecurityPolicy(false)).not.toMatch(/frame-src[^;]*(\*\s|https?:\s|'self')/)`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: `policy.ts`**

```ts
import { LIBRARY_TOKEN } from './import'

export function scenePolicy(sceneFolderUrl: string, base: string): string {
  const talkie = `${base}/__talkie/`
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${sceneFolderUrl} ${talkie}`,
    `style-src 'unsafe-inline' ${sceneFolderUrl} data:`,
    `img-src ${sceneFolderUrl} data: blob:`,
    `font-src ${sceneFolderUrl} data:`,
    `media-src ${sceneFolderUrl} data: blob:`,
    "connect-src 'none'",
    "frame-src 'none'",
    'worker-src blob:',
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; ')
}

/** The runtime first in <head>, so it owns the clock before the page's own code reads it. */
export function injectRuntime(html: string, base: string): string {
  const tag = `<script src="${base}/__talkie/runtime.js"></script>`
  const withLibraries = html.split(LIBRARY_TOKEN).join(`${base}/__talkie/lib/`)
  if (/<head\b[^>]*>/i.test(withLibraries)) return withLibraries.replace(/<head\b[^>]*>/i, (open) => `${open}${tag}`)
  return `<head>${tag}</head>${withLibraries}`
}
```

- [ ] **Step 4: Asset server** — in the request handler, after the secret check and before resolving `filePath`:

```ts
const afterSecret = requestedPath.slice(secret.length + 1)
if (afterSecret.startsWith('/__talkie/')) {
  const resource = htmlSceneResource(decodeURIComponent(afterSecret.slice('/__talkie/'.length)))
  if (!resource) return refuse()
  res.writeHead(200, { 'Content-Type': resource.type, 'Access-Control-Allow-Origin': '*' })
  createReadStream(resource.path).pipe(res)
  return
}
```

After the content type is known and the file exists:

```ts
// A scene page: Talkie's runtime goes in, and a policy that keeps it off the network and out of
// every folder but its own. Only pages under sources/html — any other HTML is served as it is.
if (extname(filePath).toLowerCase() === '.html' && filePath.includes(`${sep}sources${sep}html${sep}`)) {
  const base = `http://127.0.0.1:${port}/${secret}`
  const folderUrl = `${base}/${relative(rootDir, dirname(filePath)).split(sep).map(encodeURIComponent).join('/')}/`
  const body = Buffer.from(injectRuntime(readFileSync(filePath, 'utf-8'), base))
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': scenePolicy(folderUrl, base), 'Content-Length': body.length })
  res.end(body)
  return
}
```

(`port` is known inside `startAssetServer` once listening — keep it in a variable the handler closes over.) Add `'.html': 'text/html'`, `'.js': 'text/javascript'`, `'.css': 'text/css'`, `'.json': 'application/json'`, `'.woff2'`, `'.woff'`, `'.ttf'`, `'.otf'`, `'.gif'` to `MIME_TYPES` if missing. Add `'html'` to `SRC_MEDIA_KINDS`. In `resolveTimelineAssetUrls`, for `item.kind === 'html'` add:

```ts
...(item.kind === 'html' && existsSync(join(dirname(data.src), 'poster.png'))
  ? { posterUrl: `${resolveAssetUrl(join(dirname(data.src), 'poster.png'), rootDir, serverUrl)}?v=${encodeURIComponent((item.data as { posterStamp?: string }).posterStamp ?? '')}` }
  : {})
```

- [ ] **Step 5: Editor policy** — in both policies replace `"frame-src 'none'"` with `"frame-src http://127.0.0.1:*"`, with a comment: "HTML scenes play in a sandboxed frame served by the asset server — see htmlScene/policy.ts. Nothing else is ever framed."

- [ ] **Step 6: Run** → PASS; full `npx vitest run src/main/render src/main/security src/main/htmlScene`.
- [ ] **Step 7: Commit** — `git commit -m "Serve HTML scenes with the runtime injected and a policy of their own"`

---

### Task 6: The check — frames, problems, poster

**Files:**
- Create: `src/main/htmlScene/check.ts`, `src/main/htmlScene/check.test.ts`, `src/main/htmlScene/fixtures.ts` (test pages)

**Interfaces:**
- Consumes: asset server (`getAssetServer`, `resolveAssetUrl`), `htmlSceneResource`, `toRenderTheme`, `resolveSceneTheme`/`VARIANT_FOR`, `resolveBrowser`, protocol types
- Produces:

```ts
export interface CheckFrame { atSeconds: number; png: Buffer }
export interface CheckResult { problems: string[]; frames: CheckFrame[]; visibleText: string }
export interface CheckRequest {
  src: string                 // absolute entry path
  durationFrames: number
  params?: Record<string, unknown>
  theme: SceneTheme | null
  beats?: number[]            // seconds
  atSeconds?: number[]        // default: 0, each beat, end
  posterTo?: string           // write the 40% frame here as PNG
  rootDir: string             // asset server root (projects folder)
}
export async function checkHtmlScene(request: CheckRequest): Promise<CheckResult>
export function sceneThemeFor(theme: RenderTheme | null, variant: 'brand' | 'light' | 'dark'): SceneTheme | null
```

- [ ] **Step 1: Fixtures** (`fixtures.ts`) — exported strings:
  - `GOOD`: themed title using `var(--talkie-heading)` on `var(--talkie-bg)`, a bar that grows with a CSS animation over 2 s, and `talkie.onFrame` writing `talkie.time.toFixed(1)` into an element.
  - `HOSTILE`: script that tries `window.parent.document`, `window.top.api`, `localStorage.setItem`, `fetch('https://example.com')`, `new Image().src='https://example.com/x.png'`, `window.open('https://example.com')`, a form submit to `https://example.com`, and `location.href='https://example.com'` (each in try/catch, writing outcomes into the DOM as `ok:<name>` only if it succeeded).
  - `HARD_CODED`: `<h1 style="color:#ff0000">` on `var(--talkie-bg)`.
  - `PER_TICK`: a rAF loop doing `x += 2` per call.
  - `SILENT`: `talkie.onFrame(() => new Promise(() => {}))` (never resolves).
  - `OVERFLOW`: a 4000px-wide line of text.

- [ ] **Step 2: Failing tests** (`check.test.ts`; 120 s each; uses a temp projects root with `writeRevision`)

```ts
describe('checking an HTML scene', () => {
  it('returns the frames asked for, drawn at those moments', async () => { /* GOOD at [0, 1, 2]: three PNGs, frames differ, no problems */ })
  it('names every way out of the sandbox it tried, and none of them work', async () => {
    // HOSTILE: problems mention connect-src or img-src blocks; frame text has no "ok:"
  })
  it('reports a colour the theme did not give it', async () => { /* HARD_CODED → problem matches /#ff0000/ and /--talkie-heading/ */ })
  it('reports animation that depends on the order frames are drawn in', async () => { /* PER_TICK → /order/ */ })
  it('captures a frame the page never finishes, and says so', async () => { /* SILENT → /not drawn within 5 s/, still returns frames */ })
  it('reports text running out of the frame, and a frame of one colour', async () => { /* OVERFLOW → /out of the frame/; empty page → /blank/ */ })
  it('writes the poster and reads the words on it', async () => { /* posterTo → file exists; visibleText contains the title */ })
})
```

Write each body fully: create project, `writeRevision(id, { 'index.html': FIXTURE })`, call `checkHtmlScene({ src, durationFrames: 90, theme: sceneThemeFor(themeOf(BUILTIN_THEMES[0]), 'dark'), rootDir: projectsRootDir(baseDir), atSeconds: [...] })`, assert as described. (`themeOf` = `renderThemeFrom(theme, undefined)`.)

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: `check.ts`**

```ts
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
import { getAssetServer, resolveAssetUrl } from '../render/assetServer'
import { resolveBrowser } from '../capture/resolveBrowser'
import { FPS, WIDTH, HEIGHT } from '../../composition/constants'
import type { RenderTheme } from '../../composition/renderTheme'
import type { SceneTheme } from '../../htmlScene/protocol'

/**
 * Play a scene in a headless browser the way the video does — same sandbox, same messages — and
 * report what an author needs to know before anyone watches it. One function for the app's editor,
 * for posters, and for agents over MCP, so they all see the same thing.
 */
export function sceneThemeFor(theme: RenderTheme | null, variant: 'brand' | 'light' | 'dark'): SceneTheme | null {
  if (!theme) return null
  return { ...theme.variants[variant], fonts: theme.fonts, ...(theme.logo ? { logo: theme.logo.url } : {}) }
}

export async function checkHtmlScene(request: CheckRequest): Promise<CheckResult> {
  const server = await getAssetServer(request.rootDir)
  const pageUrl = resolveAssetUrl(request.src, request.rootDir, server.url)
  const durationSeconds = request.durationFrames / FPS
  const beats = request.beats ?? []
  const atSeconds = (request.atSeconds ?? [0, ...beats, Math.max(0, durationSeconds - 1 / FPS)])
    .map((s) => Math.min(Math.max(0, s), durationSeconds))
  const init = { fps: FPS, durationFrames: request.durationFrames, width: WIDTH, height: HEIGHT, params: request.params ?? {}, theme: request.theme, beats }

  const browser = await chromium.launch({ headless: true, channel: resolveBrowser()?.channel })
  const problems = new Set<string>()
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
    const load = async (): Promise<void> => {
      await page.goto(`${server.url}/__talkie/host.html`)
      await page.evaluate(([url, init]) => (window as any).talkieHost.load(url, init), [pageUrl, init] as const)
    }
    const shoot = async (seconds: number): Promise<Buffer> => {
      await page.evaluate((f) => (window as any).talkieHost.seek(f), Math.round(seconds * FPS))
      return page.screenshot()
    }
    const scene = () => page.frames().find((f) => f !== page.mainFrame())!

    try { await load() } catch (err) {
      problems.add(`The scene did not load: ${(err as Error).message}`)
      return { problems: [...problems], frames: [], visibleText: '' }
    }

    const frames: CheckFrame[] = []
    for (const s of atSeconds) frames.push({ atSeconds: s, png: await shoot(s) })

    // What the theme did not give it, what runs out of the frame, and the words on screen.
    const audit = await scene().evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      const allowed = ['--talkie-bg', '--talkie-heading', '--talkie-body', '--talkie-accent'].map((v) => root.getPropertyValue(v).trim().toLowerCase())
      const toHex = (c: string): string | null => {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c)
        if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null
        return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
      }
      const offTheme = new Set<string>(); const overflow: string[] = []
      for (const el of Array.from(document.body.querySelectorAll('*')) as HTMLElement[]) {
        const style = getComputedStyle(el); const rect = el.getBoundingClientRect()
        if (rect.width === 0 || style.visibility === 'hidden' || style.display === 'none') continue
        const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim())
        if (hasText) {
          const colour = toHex(style.color); if (colour && allowed[0] && !allowed.includes(colour)) offTheme.add(`text in ${colour}`)
          if (rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1 || rect.left < -1) overflow.push((el.textContent ?? '').trim().slice(0, 40))
        }
        const fill = toHex(style.backgroundColor); if (fill && allowed[0] && !allowed.includes(fill) && rect.width * rect.height > 2000) offTheme.add(`a shape in ${fill}`)
      }
      return { offTheme: [...offTheme], overflow, text: document.body.innerText.trim().slice(0, 1200) }
    })
    if (request.theme) for (const thing of audit.offTheme) problems.add(`Uses ${thing}, which is not one of the theme's colours — use var(--talkie-heading), var(--talkie-body), var(--talkie-accent) or var(--talkie-bg).`)
    for (const text of audit.overflow) problems.add(`"${text}" runs out of the frame.`)
    if (frames.length && frames.every((f) => isOneColour(f.png))) problems.add('Every frame checked is blank — a single colour.')

    // Order: the middle moment drawn cold, against the same moment after the ones before it.
    const middle = durationSeconds / 2
    await load()
    const cold = await shoot(middle)
    await load()
    for (let s = 0; s < middle; s += 0.5) await shoot(s)
    if (!cold.equals(await shoot(middle))) problems.add('The middle frame differs depending on the order frames are drawn in — animate by talkie.time, not by counting frames or ticks.')

    let visibleText = audit.text
    if (request.posterTo) {
      await load()
      writeFileSync(request.posterTo, await shoot(durationSeconds * 0.4))
      visibleText = await scene().evaluate(() => document.body.innerText.trim().slice(0, 1200))
    }
    for (const error of await page.evaluate(() => (window as any).talkieHost.errors as string[])) problems.add(error)
    return { problems: [...problems], frames, visibleText }
  } finally {
    await browser.close()
  }
}

/** A PNG that is one colour throughout, judged from Chromium's own encoding: tiny for its size. */
function isOneColour(png: Buffer): boolean {
  return png.length < 12_000
}
```

(Each `load()` clears errors only by reloading the host page; errors from all loads are collected — fine, they are the same scene.)

- [ ] **Step 5: Run** → PASS (adjust fixture thresholds only, never the assertions' intent).
- [ ] **Step 6: Commit** — `git commit -m "Check an HTML scene headless: frames, sandbox, theme, fit, order, poster"`

---

### Task 7: `HtmlScene` in the composition

**Files:**
- Create: `src/composition/items/HtmlScene.tsx`, `src/composition/items/HtmlScene.test.tsx` (jsdom: renders sandboxed iframe with the right attributes; posts init on ready; posts theme on theme change)
- Modify: `src/composition/itemRegistry.tsx`, `src/composition/LogoOverlay.tsx` (`isSlide` includes `html`), `src/main/render/htmlSceneExport.test.ts` (new; export determinism + fallback)

**Interfaces:**
- Consumes: protocol, `useRenderTheme`, `VARIANT_FOR`, `DRAW_TIMEOUT_MS`
- Produces: `HtmlScene({ data })` where data is resolved `HtmlSceneData & { src: string (URL); beats?: {at:number}[]; posterUrl?: string }`

- [ ] **Step 1: Failing jsdom test**

```tsx
it('plays the page in a frame that may run scripts and nothing more', () => {
  const { container } = render(<HtmlScene data={{ src: 'http://127.0.0.1:1/s/p/sources/html/r/index.html', title: 'T', style: { theme: 'dark' }, params: {} }} />)
  const frame = container.querySelector('iframe')!
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  expect(frame.getAttribute('src')).toContain('/sources/html/r/index.html')
})
```

(The clock hooks need a composition context: wrap with the same test helper `themedComposition.test.tsx` uses.)

- [ ] **Step 2: Implement**

```tsx
import { useEffect, useRef, useState } from 'react'
import { Fill, hold, useFrame, useRenderMode, useVideoConfig } from '../../video'
import { useRenderTheme } from '../renderTheme'
import { DRAW_TIMEOUT_MS, isSceneMessage, type SceneTheme } from '../../htmlScene/protocol'

/**
 * A scene drawn by a web page, in a frame that may run scripts and do nothing else — no access to
 * this window, its storage, or the network (see htmlScene/policy.ts). Each video frame is asked
 * for by number and, while exporting, held until the page says it has drawn it.
 */
export function HtmlScene({ data }: { data: unknown }): JSX.Element {
  const scene = data as { src: string; title: string; style?: { theme?: 'brand' | 'light' | 'dark' }; params?: Record<string, unknown>; beats?: { at: number }[] }
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width, height } = useVideoConfig()
  const theme = useRenderTheme()
  const variant = scene.style?.theme ?? 'dark'
  const sceneTheme: SceneTheme | null = theme ? { ...theme.variants[variant], fonts: theme.fonts, ...(theme.logo ? { logo: theme.logo.url } : {}) } : null
  const ref = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const rendering = useRenderMode() === 'export'
  const pending = useRef(new Map<number, () => void>())
  const nextId = useRef(1)
  const [loadHandle] = useState(() => (rendering ? delayRender('Loading the HTML scene') : null))

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== ref.current?.contentWindow || !isSceneMessage(event.data)) return
      const message = event.data
      if (message.type === 'talkie:ready') {
        ref.current!.contentWindow!.postMessage({ type: 'talkie:init', fps, durationFrames: durationInFrames, width, height, params: scene.params ?? {}, theme: sceneTheme, beats: (scene.beats ?? []).map((b) => b.at) }, '*')
        setReady(true)
        if (loadHandle !== null) continueRender(loadHandle)
      } else if (message.type === 'talkie:drawn') {
        pending.current.get(message.id)?.()
        pending.current.delete(message.id)
      } else if (message.type === 'talkie:error') {
        console.error(`HTML scene "${scene.title}": ${message.message}`)
      }
    }
    window.addEventListener('message', onMessage)
    const giveUp = setTimeout(() => { if (!ready) { setFailed(true); if (loadHandle !== null) continueRender(loadHandle) } }, 15_000)
    return () => { window.removeEventListener('message', onMessage); clearTimeout(giveUp) }
  }, [scene.src])

  useEffect(() => {
    if (ready) ref.current?.contentWindow?.postMessage({ type: 'talkie:theme', theme: sceneTheme }, '*')
  }, [ready, theme?.stamp, variant])

  useEffect(() => {
    if (!ready || failed) return
    const id = nextId.current++
    const handle = rendering ? delayRender(`HTML scene frame ${frame}`) : null
    const done = (): void => { clearTimeout(timer); if (handle !== null) continueRender(handle) }
    const timer = setTimeout(() => { console.error(`HTML scene "${scene.title}": frame ${frame} was not drawn within 5 s`); pending.current.delete(id); done() }, DRAW_TIMEOUT_MS)
    pending.current.set(id, done)
    ref.current?.contentWindow?.postMessage({ type: 'talkie:seek', frame, id }, '*')
  }, [frame, ready, failed])

  if (failed) {
    return (
      <AbsoluteFill style={{ background: sceneTheme?.background ?? '#171b22', color: sceneTheme?.heading ?? '#f4f6f9', justifyContent: 'center', alignItems: 'center', fontSize: 72 }}>
        {scene.title}
      </AbsoluteFill>
    )
  }
  return (
    <AbsoluteFill style={{ background: sceneTheme?.background ?? '#171b22' }}>
      <iframe ref={ref} src={scene.src} sandbox="allow-scripts" title={scene.title} width={width} height={height} style={{ border: 0, display: 'block' }} />
    </AbsoluteFill>
  )
}
```

Register `html: HtmlScene` in `ITEM_REGISTRY`; in `LogoOverlay.logoPlacement` make `isSlide = kind === 'scene' || kind === 'diagram' || kind === 'html'`.

- [ ] **Step 3: Export test** (`src/main/render/htmlSceneExport.test.ts`, 240 s, working directory `/` like `exportFromAnywhere.test.ts`): a project with one `html` clip (GOOD fixture, 60 frames) exported twice → decode a middle frame of each MP4 with the existing frame-sampling helper and compare equal; a second project whose page never answers still produces an MP4.
- [ ] **Step 4: Run** the jsdom test, the export test, `src/composition` tests → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Play HTML scenes in the composition, frame by frame, in a sandboxed frame"`

---

### Task 8: Scene API — add, edit, read, posters

**Files:**
- Create: `src/main/htmlScene/htmlSceneApi.ts`, `src/main/htmlScene/htmlSceneApi.test.ts`
- Modify: `src/main/render/renderProject.ts` (call `redrawStalePosters` beside `redrawStaleDiagrams`), `src/main/agent/clipEvidence.ts` (html case), `src/main/index.ts` or project-open handler (`sweepUnusedRevisions`)

**Interfaces:**
- Consumes: `writeRevision`, `importScene`, `readRevision`, `checkHtmlScene`, `sceneThemeFor`, `toRenderTheme`, `openProject`, `addTimelineItem`, `updateSceneData`, `readTimeline`, `beatsByItem`, `readTranscript`, `projectsRootDir`
- Produces:

```ts
export interface HtmlSceneInput { title?: string; files?: Record<string, string>; removeFiles?: string[]; importPath?: string; params?: Record<string, unknown>; style?: { theme?: 'brand'|'light'|'dark' }; prompt?: string; durationFrames?: number; position?: number }
export interface HtmlSceneOutcome { item: TimelineItem; check: CheckResult; warnings: string[] }
export async function addHtmlScene(projectId: string, input: HtmlSceneInput & { title: string }, baseDir?: string): Promise<HtmlSceneOutcome>
export async function editHtmlScene(projectId: string, itemId: string, input: HtmlSceneInput, baseDir?: string): Promise<HtmlSceneOutcome>
export function readHtmlScene(projectId: string, itemId: string, baseDir?: string): { item: TimelineItem; data: HtmlSceneData; files: ReturnType<typeof readRevision> }
export async function checkSceneItem(projectId: string, itemId: string, atSeconds?: number[], baseDir?: string): Promise<CheckResult>
export function posterStampFor(data: HtmlSceneData, theme: RenderTheme | null): string
export async function redrawStalePosters(projectId: string, baseDir?: string): Promise<number>
```

Behaviour:
- `addHtmlScene`: writes the revision (files or import), adds the clip at the end (or `position` via `moveTimelineItem`), duration `durationFrames ?? DEFAULT_SCENE_DURATION_FRAMES`, inside **one** `withHistory`; then runs the check with `posterTo = <dir>/poster.png`, and writes `posterStamp`, `posterText`, `check.problems` with `updateSceneData` (not a new history step — wrap only the first write in history and write the poster fields with a plain `updateSceneData`).
- `editHtmlScene`: new revision `from` the current `src` when files change; merges params/style/title; one history step; re-check as above.
- `posterStampFor`: `${dirname(src)}:${theme?.stamp ?? 'none'}:${style.theme}` — the folder changes with every file change, so this covers files.
- `redrawStalePosters`: for each html clip whose `posterStamp` ≠ `posterStampFor(...)`, re-run the check for the poster only (`atSeconds: []`) and update.
- `clipEvidence`: `if (item.kind === 'html')` → `sceneText: [\`Title: ${title}\`, prompt && \`Made to show: ${prompt}\`, posterText && \`Words on screen: ${posterText}\`].filter(Boolean).join('\n')`, kind `'scene'`.

- [ ] **Step 1: Failing tests** — add makes a clip with a poster and check; edit with files makes a new folder and undo restores the old `src`; edit with only params keeps the folder; a theme change makes the poster stale and `redrawStalePosters` redraws it; `gatherClipEvidence` of an html clip contains its title and on-screen words.
- [ ] **Step 2–4: Implement, run, typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "Add, edit and read HTML scenes, with posters kept current"`

---

### Task 9: The guide, the templates, and writing scenes with AI

**Files:**
- Create: `src/main/htmlScene/guide.ts`, `src/main/htmlScene/writeHtmlScene.ts`, `src/main/htmlScene/writeHtmlScene.test.ts`, `resources/html-templates/{kinetic-title,bar-chart,counter,code-walkthrough,before-after,lottie}/index.html` (+ `lottie/animation.json`), `src/main/htmlScene/templates.test.ts`

**Interfaces:**
- Produces: `HTML_SCENE_GUIDE: string`; `listTemplates(): { id: string; name: string; description: string }[]` (from a `<meta name="talkie:template" content="Name — description">` in each); `templateFiles(id: string): Record<string, string | Buffer>`; `writeHtmlScene(request: { instruction: string; current?: Record<string, string>; title?: string; projectName: string; context?: ProjectContext; problems?: string[] }, baseDir?: string): Promise<{ status: 'written'; files: Record<string, string>; title: string } | { status: 'failed'; reason: string }>`

Guide content (exact text lives in `guide.ts`; must cover): what a scene is; `window.talkie` API table; theme variables with an example `body { background: var(--talkie-bg); color: var(--talkie-body); font-family: var(--talkie-font-body) }`; libraries available as `<script src="__TALKIE_LIB__/d3.min.js">` etc. and `talkie.anime(...)`/`talkie.lottie(...)`; rules — no network, everything in the folder, animate by `talkie.time` (never per tick), create animations at load, keep text inside 1920×1080, use `talkie.beats` to reveal with narration, `talkie.params` for numbers and words; a 20-line example.

`writeHtmlScene`: mirrors `writeScene` — provider from settings, `complete()` required, prompt = guide + project context + instruction (+ current files + problems when changing); parse a reply of the form:

```
TITLE: <title>
=== index.html ===
<contents>
=== style.css ===
<contents>
```

into files; refuse a reply with no `index.html`. One automatic retry: the caller (`htmlSceneApi`/IPC) checks the result and, if problems, calls again with `problems`.

- [ ] **Step 1: Failing tests** — `writeHtmlScene` with a stub provider (inject `complete` via settings stub as `writeScene.test.ts` does) parses files and title; a reply without `index.html` fails with a reason; every template loads in `checkHtmlScene` with **no problems** under each built-in theme's dark variant (templates.test.ts, 180 s).
- [ ] **Step 2: Templates** — each `index.html` uses only theme variables, `talkie.params` (with defaults), and `talkie.beats`; bar-chart uses D3 via `__TALKIE_LIB__/d3.min.js` and draws by `talkie.onFrame(t => …)`; lottie uses `__TALKIE_LIB__/lottie.min.js`, `animationData` inlined from `animation.json` via `fetch`? — **no**, fetch is blocked: inline the JSON in a `<script type="application/json">` and `JSON.parse` it.
- [ ] **Step 3–4: Implement, run.**
- [ ] **Step 5: Commit** — `git commit -m "Write HTML scenes from a description, with a guide and six templates"`

---

### Task 10: IPC, preload and client

**Files:**
- Create: `src/main/ipc/htmlSceneHandlers.ts`
- Modify: `src/main/index.ts` (register), `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/src/api/projectClient.ts`

Channels (all `withHistory` handled inside `htmlSceneApi`):

| Channel | Calls |
|---|---|
| `project:htmlScene:add` | `addHtmlScene(id, input)` |
| `project:htmlScene:edit` | `editHtmlScene(id, itemId, input)` |
| `project:htmlScene:read` | `readHtmlScene(id, itemId)` |
| `project:htmlScene:check` | `checkSceneItem(id, itemId, atSeconds)` → frames as base64 data URLs |
| `project:htmlScene:import` | open dialog (`openFile`, `openDirectory`, filter `html`) → `addHtmlScene(id, { importPath, title: basename })`; `null` if cancelled |
| `project:htmlScene:write` | `writeHtmlScene(...)` then, if `problems`, once more with them |
| `project:htmlScene:templates` | `listTemplates()` |
| `project:htmlScene:fromTemplate` | `addHtmlScene(id, { files: templateFiles(t), title })` |

- [ ] **Step 1:** Implement; run `channelCoverage.test.ts` (fails until the preload calls exist) → add preload `htmlSceneApi` and `window.api.htmlScene`, `ProjectClient.htmlScene` wrappers → PASS.
- [ ] **Step 2:** typecheck; commit — `git commit -m "Reach HTML scenes from the window"`

---

### Task 11: The editor

**Files:**
- Create: `src/renderer/src/components/htmlScene/HtmlSceneEditor.tsx`, `CodePanel.tsx`, `ParamsForm.tsx`, `AddHtmlScene.tsx`, `htmlScene.test.tsx`
- Modify: `src/renderer/src/components/SceneEditor.tsx` (route `kind === 'html'` to `HtmlSceneEditor`; "HTML scene" in the add menu opens `AddHtmlScene`), `src/renderer/src/components/Timeline.tsx` (`ClipThumbnail` html → `<img src={posterUrl}>` or a themed title card), `src/renderer/src/screens/Editor.tsx` (pass theme), `package.json` (`codemirror`, `@codemirror/lang-html`, `@codemirror/lang-css`, `@codemirror/lang-javascript`)

Behaviour:
- `AddHtmlScene`: three buttons — Describe it (textarea → `htmlScene.write` → `htmlScene.add`), Template (grid from `templates`), Import (`htmlScene.import`). Shows progress and the provider's failure reason.
- `HtmlSceneEditor`: left — tabs per text file (`CodePanel` with CodeMirror, language by extension), **Look** (Brand/Light/Dark), **Values** (`ParamsForm`: string → input, number → number input, boolean → checkbox, number[] → comma list, else JSON textarea with parse error), **Change with AI** box; right — the preview player with a one-clip timeline of the unsaved scene? **No**: unsaved files are not on disk; preview = the *saved* scene, refreshed after **Save** (Save is quick: new revision + check). Problems list from the last check. Save → `htmlScene.edit`.
- Thumbnail: `posterUrl` image; without one, the scene title on the theme background (as slides).

- [ ] **Step 1: Failing tests** (jsdom, client mocked): add dialog offers three ways; a template click calls `fromTemplate`; editor shows file tabs and problems; changing a value and saving calls `edit` with the new params; Look change calls `edit` with style; thumbnail renders the poster image.
- [ ] **Step 2–4: Implement, run, typecheck.** Use design tokens only.
- [ ] **Step 5: Commit** — `git commit -m "Make and edit HTML scenes in the app: describe, template, import, code"`

---

### Task 12: MCP tools

**Files:**
- Modify: `src/mcp/server.ts`, `src/mcp/server.test.ts`, `src/main/agent/projectAgent.ts`

Tools exactly as spec section 5. Replies: text (clip id, problems, warnings) **plus** `{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }` per frame (cap 6). `path` must be absolute (reuse `readLocalFile`'s rule). `talkie_html_scene_guide` returns `HTML_SCENE_GUIDE`.

- [ ] **Step 1: Failing tests** — guide mentions `talkie.onFrame` and `--talkie-heading`; add with `files` returns a clip id, an image content item, no problems for a themed page; add with a relative `path` is refused; edit with params only keeps `src`; check at `[0.5]` returns one image; read returns the file list; `talkie_move_clip`/`talkie_delete_clip` work on the html clip; `AGENT_TOOLS` contains all five html tools.
- [ ] **Step 2–4: Implement, run.**
- [ ] **Step 5: Commit** — `git commit -m "Give agents HTML scenes, and let them see the frames they made"`

---

### Task 13: Licences, docs, packaged check, full verification

**Files:**
- Modify: `scripts/generateNotices.mjs` if needed (new deps are picked up from `node_modules`), `NOTICE` (via `npm run notices`), `AGENTS.md` (an "HTML scenes" section + security invariant: "Scene pages run in `sandbox="allow-scripts"` frames with `connect-src 'none'`; never add `allow-same-origin`"), `src/main/licences.test.ts` (assert anime.js/d3/lottie-web/codemirror present, gsap absent)

- [ ] **Step 1:** `npm run notices`; licences test.
- [ ] **Step 2:** `npm run build`; confirm `out/html-scene/{runtime.js,host.js,host.html,lib/*,templates/*}` exist.
- [ ] **Step 3:** Packaged-style export from `/` with an HTML scene (the Task 7 export test already runs from `/`; run it against the built `out/` by setting the resolver's `fromDir`) → PASS.
- [ ] **Step 4:** Render frames of each template under a light and a dark built-in theme with `renderStill`; look at them.
- [ ] **Step 5:** `npm run typecheck && npm test` → all pass.
- [ ] **Step 6: Commit** — `git commit -m "Document HTML scenes and their sandbox, and list the new licences"`

---

## Self-review

- **Spec coverage:** §1 kind/data/folder → T1 (+ revision deviation); allowed files/limits → T1/T2; §2 serving/CSP/__talkie/iframe/editor policy → T5, T7; §3 runtime API, variables, clock, seek steps, messages → T3; host timeout/fallback → T7; §4 describe/template/import/editor/thumbnail/narration → T9, T2, T11, T8; §5 MCP → T12; §6 check → T6; §7 tests → T6, T7, T5, T2, T12, T13; §8 licences/packaging → T4, T13.
- **Types:** `SceneTheme`, `InitMessage`, `CheckResult`, `HtmlSceneData`, `HtmlSceneInput` defined once and used by name thereafter. `writeRevision` returns an entry path everywhere.
- **Known judgement calls for the executor:** the blank-frame heuristic (PNG size) and the theme audit's area threshold may need tuning against the fixtures — tune constants, not test intent.
