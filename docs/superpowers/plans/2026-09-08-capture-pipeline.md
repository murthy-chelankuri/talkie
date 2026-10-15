# Capture Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a developer record a real browser session — a Playwright-controlled Chromium instance navigating a URL they choose — capturing real video and a structured, timestamped action log, with a small always-on-top toolbar for live annotations (important/redo/skip), saved to the project on disk.

**Architecture:** A `startRecordingSession` function in the main process launches Playwright's own managed Chromium (separate from Electron's), using Playwright's built-in video recording plus a hybrid event-capture approach: an injected page script + `exposeFunction` bridge for clicks/input (needs real DOM access), and direct Node-side Playwright event listeners for navigation/console errors (no injection needed there). A second, minimal `BrowserWindow` — the recording toolbar — drives start/stop/annotate via IPC.

**Tech Stack:** Playwright (`chromium`), on top of Plan 1's Electron+React+TypeScript+Vitest foundation and Plan 2's `ProjectAPI`.

**Spec:** `docs/superpowers/specs/2026-09-06-demo-editor-design.md`

## Global Constraints

- Action log entries match the spec's JSONL shape (§6): `{t, type, selector?, text?, url?, value?}` with `type` one of `click`, `navigation`, `input`, `console.error` — this plan adds `annotation` as a fifth type for toolbar marks (`important`/`redo`/`skip`), which the spec's toolbar description implies but doesn't give an exact schema for.
- A recorded session is saved to `sources/session-<id>/video.webm` and `sources/session-<id>/actions.jsonl` (spec §4) — capture never writes into `timeline.json` (spec §6); turning a recording into timeline clips is explicitly out of scope for this plan (see below).
- Sensitive input values must not land in the action log verbatim — the spec's own example JSONL shows `"value": "[redacted-if-sensitive]"`. v1 heuristic: redact any input whose `type` attribute is `password`.
- Reading a file that's appended-to incrementally (`actions.jsonl`) must tolerate a malformed trailing line (e.g. from a crash mid-write) by skipping it and logging, never failing the whole read — this is the same lesson Plan 2's final review surfaced for `timeline.json` (one bad row must not break the whole read), applied here from the start rather than discovered later.
- No comments explaining *what* code does — only where a non-obvious constraint needs flagging.
- macOS only for v1 (spec §1).
- This plan develops directly on `main` — no worktree isolation. Worktrees are reserved for genuinely parallel/independent work, not this single sequential plan.

---

## Plan sequence context

This is **Plan 3 of the overall spec** (Plans 1-2 — project foundation, timeline/compositor — merged to `main`). It covers the *recording* half of spec §6 only. Explicitly **out of scope for this plan** (disclosed, deliberate cuts):

- **Auto-cut into candidate clips and a `clip` timeline-item kind.** Spec §6 describes splitting the recorded video into clips at navigation boundaries and adding them as timeline items. That requires a new `TimelineItem` kind (`clip`), a video-playback composition component, extending Plan 2's asset-server URL-resolution to video files, and video-cutting logic (likely ffmpeg-based, reusing the ffmpeg already bundled). That's a full subsystem in its own right — this plan stops once a session's raw video + action log exist on disk; turning that into timeline clips is the next plan.
- **PPT import** (spec §6) — already deferred by Plan 2, unaffected by this plan.
- **Redaction beyond password fields.** The spec's own example shows one redacted value; broader heuristics (credit-card fields, `autocomplete` hints, etc.) are a future refinement, not a v1 requirement.
- **Multiple concurrent recording sessions.** The IPC layer holds one active session at a time (`activeSession` module-level variable) — starting a second while one is in progress throws a clear error rather than silently corrupting state. Concurrent sessions aren't a realistic v1 need (a developer records one demo at a time) and would otherwise require a session-id-keyed registry for no current benefit.
- **Packaging-safe path resolution for the toolbar's HTML file.** Like Plan 2's composition bundle entry point, `toolbar.html` is loaded via a path resolved relative to `process.cwd()`, correct for `npm run dev`/`npm start` (this plan's entire execution and test context) but not yet safe inside a packaged/asar'd app. Packaging remains unaddressed by any plan so far.

---

## File Structure

```
package.json                                    # + playwright
src/
  main/
    capture/
      actionLog.ts                                # ActionLogEntry type, appendActionLogEntry, readActionLog (lenient)
      actionLog.test.ts
      redact.ts                                   # shouldRedactInputValue()
      redact.test.ts
      recordSession.ts                            # startRecordingSession(), RecordingSession interface
      recordSession.test.ts                       # real Playwright integration test
      fixtures/
        recording-test-page.html                  # local fixture page for the integration test
      toolbarWindow.ts                            # openToolbarWindow(), closeToolbarWindow()
      toolbar.html                                # plain HTML/JS UI for the recording toolbar (no build step)
    ipc/
      captureHandlers.ts                          # project:capture:start/mark/stop/openToolbar
    index.ts                                       # (modify) register capture handlers
  preload/
    index.ts                                       # (modify) + captureApi
    index.d.ts                                      # (modify) + CaptureApi type
  renderer/src/
    api/
      projectClient.ts                             # (modify) + captureClient
    screens/
      Editor.tsx                                   # (modify) + "Record Session" button + URL prompt
```

---

### Task 1: Install Playwright

**Files:**
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: nothing
- Produces: `playwright` installed with its Chromium browser downloaded — every later task in this plan depends on this

Installing only Chromium (not Firefox/WebKit, which `playwright`'s default postinstall would otherwise also download) saves significant time and disk — the spec only needs Chromium.

- [ ] **Step 1: Install the package without triggering the default all-browsers download**

Run: `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright@latest`

- [ ] **Step 2: Install only Chromium**

Run: `npx playwright install chromium`
Expected: downloads and installs a Chromium build (may take a minute or two on first run — this is expected, not a bug).

- [ ] **Step 3: Verify the install didn't break the existing build**

Run: `npm run typecheck`
Expected: exits 0 (Playwright isn't imported anywhere yet, so this just confirms the install itself didn't corrupt `node_modules`/`package-lock.json`)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "Install Playwright (Chromium only)"
```

---

### Task 2: Action log module

**Files:**
- Create: `src/main/capture/actionLog.ts`
- Test: `src/main/capture/actionLog.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface ActionLogEntry { t: number; type: 'click' | 'navigation' | 'input' | 'console.error' | 'annotation'; selector?: string; text?: string; url?: string; value?: string; annotation?: 'important' | 'redo' | 'skip' }`
  - `appendActionLogEntry(actionLogPath: string, entry: ActionLogEntry): void`
  - `readActionLog(actionLogPath: string): ActionLogEntry[]` (lenient — skips malformed lines)
  - Used by Task 3 is unrelated; used by Task 4 (`recordSession.ts`) and Task 7 (verification)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { appendActionLogEntry, readActionLog, type ActionLogEntry } from './actionLog'

describe('appendActionLogEntry / readActionLog', () => {
  let dir: string
  let logPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-actionlog-test-'))
    logPath = join(dir, 'actions.jsonl')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns an empty array when the log file does not exist yet', () => {
    expect(readActionLog(logPath)).toEqual([])
  })

  it('appends and reads back entries in order', () => {
    const first: ActionLogEntry = { t: 100, type: 'click', selector: '#button' }
    const second: ActionLogEntry = { t: 200, type: 'navigation', url: 'https://example.com/cart' }

    appendActionLogEntry(logPath, first)
    appendActionLogEntry(logPath, second)

    expect(readActionLog(logPath)).toEqual([first, second])
  })

  it('skips a malformed trailing line rather than failing the whole read', () => {
    appendActionLogEntry(logPath, { t: 100, type: 'click', selector: '#button' })
    appendFileSync(logPath, '{"t": 200, "type": "click", "selector": "#unterm\n', 'utf-8')

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const entries = readActionLog(logPath)

    expect(entries).toEqual([{ t: 100, type: 'click', selector: '#button' }])
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('ignores blank lines', () => {
    writeFileSync(logPath, '{"t": 100, "type": "click", "selector": "#a"}\n\n\n', 'utf-8')

    expect(readActionLog(logPath)).toEqual([{ t: 100, type: 'click', selector: '#a' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/capture/actionLog.test.ts`
Expected: FAIL — `Cannot find module './actionLog'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { appendFileSync, existsSync, readFileSync } from 'fs'

export interface ActionLogEntry {
  t: number
  type: 'click' | 'navigation' | 'input' | 'console.error' | 'annotation'
  selector?: string
  text?: string
  url?: string
  value?: string
  annotation?: 'important' | 'redo' | 'skip'
}

export function appendActionLogEntry(actionLogPath: string, entry: ActionLogEntry): void {
  appendFileSync(actionLogPath, `${JSON.stringify(entry)}\n`, 'utf-8')
}

export function readActionLog(actionLogPath: string): ActionLogEntry[] {
  if (!existsSync(actionLogPath)) return []

  const raw = readFileSync(actionLogPath, 'utf-8')
  const entries: ActionLogEntry[] = []

  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      entries.push(JSON.parse(line))
    } catch (err) {
      console.error('Skipping malformed action log line:', err)
    }
  }

  return entries
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/capture/actionLog.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/capture/actionLog.ts src/main/capture/actionLog.test.ts
git commit -m "Add action log read/write module"
```

---

### Task 3: Redaction helper

**Files:**
- Create: `src/main/capture/redact.ts`
- Test: `src/main/capture/redact.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `shouldRedactInputValue(inputType: string): boolean` — used by Task 4

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { shouldRedactInputValue } from './redact'

describe('shouldRedactInputValue', () => {
  it('redacts password inputs', () => {
    expect(shouldRedactInputValue('password')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(shouldRedactInputValue('PASSWORD')).toBe(true)
  })

  it('does not redact ordinary text inputs', () => {
    expect(shouldRedactInputValue('text')).toBe(false)
  })

  it('does not redact email inputs', () => {
    expect(shouldRedactInputValue('email')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/capture/redact.test.ts`
Expected: FAIL — `Cannot find module './redact'`

- [ ] **Step 3: Write minimal implementation**

```ts
export function shouldRedactInputValue(inputType: string): boolean {
  return inputType.toLowerCase() === 'password'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/capture/redact.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/capture/redact.ts src/main/capture/redact.test.ts
git commit -m "Add input redaction helper"
```

---

### Task 4: `startRecordingSession`

**Files:**
- Create: `src/main/capture/recordSession.ts`
- Test: `src/main/capture/recordSession.test.ts`
- Create: `src/main/capture/fixtures/recording-test-page.html`

**Interfaces:**
- Consumes: `findProjectDir` (Plan 1), `appendActionLogEntry`, `type ActionLogEntry` (Task 2), `shouldRedactInputValue` (Task 3)
- Produces:
  - `interface RecordingSession { sessionId: string; page: Page; markAnnotation(annotation: 'important' | 'redo' | 'skip'): void; stop(): Promise<{ sessionId: string; videoPath: string; actionLogPath: string }> }` (`Page` is Playwright's own exported type)
  - `startRecordingSession(projectId: string, url: string, baseDir?: string): Promise<RecordingSession>`
  - Used by Task 5 (`captureHandlers.ts`)

This is the plan's highest-risk task — a real integration with Playwright, not just unit logic. The `page` field on `RecordingSession` exists specifically so this task's own test can drive real interactions (clicks, typing) against the recorded page — in production, "driving the page" is just the developer using their mouse and keyboard on the actual Chromium window Playwright opened.

- [ ] **Step 1: Write the fixture page**

```html
<!DOCTYPE html>
<html>
<head>
  <title>Recording Test Page</title>
</head>
<body>
  <button id="test-button">Click Me</button>
  <input id="test-text" type="text" />
  <input id="test-password" type="password" />
  <a id="test-link" href="#navigated">Navigate</a>
</body>
</html>
```

- [ ] **Step 2: Write the failing test**

This is a real end-to-end test — launches a real Chromium instance, records a real video, drives real page interactions, and asserts on the real resulting files. Expect it to take real time (tens of seconds), and possibly longer on the very first run if Chromium needs a final setup step.

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../project/projectApi'
import { startRecordingSession } from './recordSession'
import { readActionLog } from './actionLog'

describe('startRecordingSession (real Playwright)', () => {
  it('records real clicks and navigation, and redacts password input values', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-capture-test-'))
    const project = createProject('Capture Test', baseDir)
    const fixtureUrl = `file://${join(__dirname, 'fixtures', 'recording-test-page.html')}`

    const session = await startRecordingSession(project.id, fixtureUrl, baseDir)

    await session.page.click('#test-button')
    await session.page.fill('#test-password', 'super-secret')
    await session.page.click('#test-link')
    session.markAnnotation('important')

    // The injected listener calls window.__demoEditorRecordAction(...) without awaiting it
    // (a fire-and-forget call from the page's perspective), so a page.click()/fill() promise
    // resolving does not guarantee the corresponding Node-side exposeFunction callback — and
    // therefore the action-log write — has completed yet. Give any in-flight calls a moment
    // to land before reading the log back.
    await session.page.waitForTimeout(300)

    const result = await session.stop()

    expect(existsSync(result.videoPath)).toBe(true)
    expect(statSync(result.videoPath).size).toBeGreaterThan(0)

    const entries = readActionLog(result.actionLogPath)

    const click = entries.find((e) => e.type === 'click' && e.selector === '#test-button')
    expect(click).toBeDefined()

    const passwordEntry = entries.find((e) => e.type === 'input' && e.selector === '#test-password')
    expect(passwordEntry?.value).toBe('[redacted]')

    const navigation = entries.find((e) => e.type === 'navigation' && e.url?.includes('#navigated'))
    expect(navigation).toBeDefined()

    const annotation = entries.find((e) => e.type === 'annotation')
    expect(annotation?.annotation).toBe('important')

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)
})
```

If `page.fill()` doesn't trigger a `change` event the way this test expects (behavior can vary slightly across Playwright versions), check `node_modules/playwright-core/types/types.d.ts` for `fill`'s documented behavior, or switch to `page.locator('#test-password').pressSequentially('super-secret')` followed by `page.keyboard.press('Tab')` to force a blur/change — the point being verified is "a real `input`-type event reaches the exposed function and gets redacted," not the exact interaction method.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/capture/recordSession.test.ts`
Expected: FAIL — `Cannot find module './recordSession'`

- [ ] **Step 4: Write the implementation**

```ts
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { randomUUID } from 'crypto'
import { mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { findProjectDir } from '../project/paths'
import { appendActionLogEntry, type ActionLogEntry } from './actionLog'
import { shouldRedactInputValue } from './redact'

export interface RecordingSession {
  sessionId: string
  page: Page
  markAnnotation: (annotation: 'important' | 'redo' | 'skip') => void
  stop: () => Promise<{ sessionId: string; videoPath: string; actionLogPath: string }>
}

const INJECTED_LISTENER_SCRIPT = `
(() => {
  function selectorFor(el) {
    if (el.id) return '#' + el.id
    if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]'
    return el.tagName.toLowerCase()
  }

  document.addEventListener('click', (event) => {
    const el = event.target
    if (!(el instanceof Element)) return
    window.__demoEditorRecordAction({
      kind: 'click',
      selector: selectorFor(el),
      text: (el.textContent || '').trim().slice(0, 100)
    })
  }, true)

  document.addEventListener('change', (event) => {
    const el = event.target
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return
    window.__demoEditorRecordAction({
      kind: 'input',
      selector: selectorFor(el),
      value: el.value,
      inputType: 'type' in el ? el.type : 'text'
    })
  }, true)
})()
`

function normalizeUrl(url: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
}

export async function startRecordingSession(
  projectId: string,
  url: string,
  baseDir: string = homedir()
): Promise<RecordingSession> {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${projectId}`)
  }

  const sessionId = randomUUID()
  const sessionDir = join(dir, 'sources', `session-${sessionId}`)
  mkdirSync(sessionDir, { recursive: true })
  const actionLogPath = join(sessionDir, 'actions.jsonl')
  const startTime = Date.now()

  const browser: Browser = await chromium.launch()
  const context: BrowserContext = await browser.newContext({
    recordVideo: { dir: sessionDir, size: { width: 1280, height: 720 } }
  })

  await context.exposeFunction('__demoEditorRecordAction', (data: Record<string, unknown>) => {
    const isRedactedInput = data.kind === 'input' && shouldRedactInputValue((data.inputType as string) ?? '')
    const entry: ActionLogEntry = {
      t: Date.now() - startTime,
      type: data.kind as ActionLogEntry['type'],
      selector: data.selector as string | undefined,
      text: data.text as string | undefined,
      value: isRedactedInput ? '[redacted]' : (data.value as string | undefined)
    }
    appendActionLogEntry(actionLogPath, entry)
  })

  await context.addInitScript(INJECTED_LISTENER_SCRIPT)

  const page: Page = await context.newPage()

  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return
    appendActionLogEntry(actionLogPath, { t: Date.now() - startTime, type: 'navigation', url: frame.url() })
  })

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    appendActionLogEntry(actionLogPath, { t: Date.now() - startTime, type: 'console.error', text: msg.text() })
  })

  await page.goto(normalizeUrl(url))

  function markAnnotation(annotation: 'important' | 'redo' | 'skip'): void {
    appendActionLogEntry(actionLogPath, { t: Date.now() - startTime, type: 'annotation', annotation })
  }

  async function stop(): Promise<{ sessionId: string; videoPath: string; actionLogPath: string }> {
    const video = page.video()
    await context.close()
    await browser.close()

    const videoPath = join(sessionDir, 'video.webm')
    if (video) {
      const actualPath = await video.path()
      if (actualPath !== videoPath) {
        renameSync(actualPath, videoPath)
      }
    }

    return { sessionId, videoPath, actionLogPath }
  }

  return { sessionId, page, markAnnotation, stop }
}
```

If the installed Playwright version's types don't match `chromium.launch`/`browser.newContext`/`context.exposeFunction`/`context.addInitScript`/`video.path`'s exact signatures above, check `node_modules/playwright-core/types/types.d.ts` and adapt — these are long-stable, core Playwright APIs, so the approach (launch → context with `recordVideo` → expose a Node callback → inject a DOM listener script → attach Node-side `framenavigated`/`console` listeners → navigate → on stop, close then rename the video to a fixed filename) is what matters, not the exact parameter names.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/capture/recordSession.test.ts`
Expected: PASS (1 test — real browser launch + recording, expect real wall-clock time)

- [ ] **Step 6: Commit**

```bash
git add src/main/capture/recordSession.ts src/main/capture/recordSession.test.ts src/main/capture/fixtures/recording-test-page.html
git commit -m "Add startRecordingSession (real Playwright capture)"
```

---

### Task 5: IPC handlers and recording toolbar window

**Files:**
- Create: `src/main/ipc/captureHandlers.ts`
- Create: `src/main/capture/toolbarWindow.ts`
- Create: `src/main/capture/toolbar.html`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Interfaces:**
- Consumes: `startRecordingSession`, `type RecordingSession` (Task 4)
- Produces:
  - `window.api.capture.openToolbar(projectId: string): Promise<void>`
  - `registerCaptureHandlers(ipcMain: IpcMain): void` registering `project:capture:start`, `project:capture:mark`, `project:capture:stop`, `project:capture:openToolbar`
  - Used by Task 6 (`Editor.tsx`)

**A deliberate security trade-off, disclosed:** the toolbar window uses `nodeIntegration: true, contextIsolation: false` (unlike the main Editor window, which uses a proper `contextBridge` preload). This is safe here specifically because the toolbar only ever loads `toolbar.html` — our own static file, never remote or user-supplied content — so there is no untrusted-content boundary to protect. Using a full preload+contextBridge setup for four buttons would be process ceremony with no security benefit in this specific case.

- [ ] **Step 1: Write `src/main/capture/toolbar.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <title>Recording Toolbar</title>
</head>
<body>
  <div id="setup">
    <input id="url-input" type="text" placeholder="https://..." style="width: 250px" />
    <button id="start">Start Recording</button>
  </div>
  <div id="controls" style="display: none">
    <button id="important">Important</button>
    <button id="redo">Redo</button>
    <button id="skip">Skip</button>
    <button id="stop">Stop</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron')
    const projectId = new URLSearchParams(window.location.search).get('projectId')

    document.getElementById('start').onclick = async () => {
      const url = document.getElementById('url-input').value
      await ipcRenderer.invoke('project:capture:start', projectId, url)
      document.getElementById('setup').style.display = 'none'
      document.getElementById('controls').style.display = 'block'
    }

    document.getElementById('important').onclick = () => ipcRenderer.invoke('project:capture:mark', 'important')
    document.getElementById('redo').onclick = () => ipcRenderer.invoke('project:capture:mark', 'redo')
    document.getElementById('skip').onclick = () => ipcRenderer.invoke('project:capture:mark', 'skip')

    document.getElementById('stop').onclick = async () => {
      await ipcRenderer.invoke('project:capture:stop')
      window.close()
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Write `src/main/capture/toolbarWindow.ts`**

```ts
import { BrowserWindow } from 'electron'
import { join } from 'path'

let toolbarWindow: BrowserWindow | null = null

export function openToolbarWindow(projectId: string): BrowserWindow {
  toolbarWindow = new BrowserWindow({
    width: 360,
    height: 160,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  toolbarWindow.loadFile(join(process.cwd(), 'src/main/capture/toolbar.html'), { query: { projectId } })

  toolbarWindow.on('closed', () => {
    toolbarWindow = null
  })

  return toolbarWindow
}
```

- [ ] **Step 3: Write `src/main/ipc/captureHandlers.ts`**

```ts
import type { IpcMain } from 'electron'
import { startRecordingSession, type RecordingSession } from '../capture/recordSession'
import { openToolbarWindow } from '../capture/toolbarWindow'

let activeSession: RecordingSession | null = null

export function registerCaptureHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('project:capture:openToolbar', (_event, projectId: string) => {
    openToolbarWindow(projectId)
  })

  ipcMain.handle('project:capture:start', async (_event, projectId: string, url: string) => {
    if (activeSession) {
      throw new Error('A recording session is already in progress')
    }
    activeSession = await startRecordingSession(projectId, url)
    return { sessionId: activeSession.sessionId }
  })

  ipcMain.handle('project:capture:mark', (_event, annotation: 'important' | 'redo' | 'skip') => {
    if (!activeSession) {
      throw new Error('No recording session is in progress')
    }
    activeSession.markAnnotation(annotation)
  })

  ipcMain.handle('project:capture:stop', async () => {
    if (!activeSession) {
      throw new Error('No recording session is in progress')
    }
    const result = await activeSession.stop()
    activeSession = null
    return result
  })
}
```

- [ ] **Step 4: Wire it into `src/main/index.ts`**

Add the import:

```ts
import { registerCaptureHandlers } from './ipc/captureHandlers'
```

Inside `app.whenReady().then(() => { ... })`, alongside the existing handler registrations:

```ts
registerCaptureHandlers(ipcMain)
```

- [ ] **Step 5: Extend `src/preload/index.ts`**

Add to the existing file:

```ts
const captureApi = {
  openToolbar: (projectId: string): Promise<void> => ipcRenderer.invoke('project:capture:openToolbar', projectId)
}

// Change the exposeInMainWorld call to:
// contextBridge.exposeInMainWorld('api', { project: projectApi, timeline: timelineApi, render: renderApi, capture: captureApi })

export type CaptureApi = typeof captureApi
```

- [ ] **Step 6: Extend `src/preload/index.d.ts`**

```ts
import type { ProjectApi, TimelineApi, RenderApi, CaptureApi } from './index'

declare global {
  interface Window {
    api: {
      project: ProjectApi
      timeline: TimelineApi
      render: RenderApi
      capture: CaptureApi
    }
  }
}
```

- [ ] **Step 7: Manual verification**

Run: `npm run typecheck`
Expected: exits 0

Run: `npm run build`
Expected: exits 0

- [ ] **Step 8: Commit**

```bash
git add src/main/capture/toolbar.html src/main/capture/toolbarWindow.ts src/main/ipc/captureHandlers.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "Add capture IPC handlers and recording toolbar window"
```

---

### Task 6: "Record Session" entry point in the Editor

**Files:**
- Modify: `src/renderer/src/api/projectClient.ts`
- Modify: `src/renderer/src/screens/Editor.tsx`

**Interfaces:**
- Consumes: `window.api.capture.openToolbar` (Task 5)
- Produces: updated `Editor` component

- [ ] **Step 1: Add `captureClient` to `projectClient.ts`**

Add to `src/renderer/src/api/projectClient.ts`:

```ts
export const captureClient = {
  openToolbar: (projectId: string): Promise<void> => window.api.capture.openToolbar(projectId)
}
```

- [ ] **Step 2: Add the button to `Editor.tsx`**

In `src/renderer/src/screens/Editor.tsx`, add `captureClient` to the existing import from `'../api/projectClient'`, add a handler, and add the button next to the existing "Import Image"/"Export Video" buttons in the left `<aside>`:

```tsx
async function handleRecordSession(): Promise<void> {
  await captureClient.openToolbar(projectId)
}
```

```tsx
<button onClick={handleRecordSession}>Record Session</button>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: exits 0

Run: `npm run build`
Expected: exits 0

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/api/projectClient.ts src/renderer/src/screens/Editor.tsx
git commit -m "Add Record Session entry point to the Editor"
```

---

### Task 7: Full plan verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `npm run test`
Expected: PASS — every suite from Plans 1-2 plus this plan's new ones (`actionLog`, `redact`, `recordSession`). The real Playwright capture test adds real wall-clock time to the run — that's expected, not a regression.

- [ ] **Step 2: Run the full typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0

- [ ] **Step 3: Note on manual/headless verification limits**

Unlike Plans 1-2's DOM-simulation technique, this task does not attempt to drive the "Record Session" button → toolbar window → real recording flow end-to-end in this headless environment — that would require simultaneously scripting interaction across two separate `BrowserWindow`s (the Editor and the toolbar) plus a third, Playwright-controlled Chromium instance, which is disproportionate for a verification step. Task 4's own real integration test is the load-bearing proof that recording genuinely works; this task's typecheck/build confirms the IPC/window-management wiring is structurally sound. Note this limitation rather than silently skipping it — a human should click "Record Session" in a real window at least once before considering this plan fully proven end-to-end.

- [ ] **Step 4: Final commit** (only if any of the above required fixes)

```bash
git add -A
git commit -m "Fix issues found in Plan 3 full verification"
```

If nothing needed fixing, there is nothing to commit — Plan 3 is complete.
