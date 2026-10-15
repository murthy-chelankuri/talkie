# Narration Agent Implementation Plan

**Goal:** Draft the narration for a clip automatically — from what happened during a browser
recording, or from what an image actually shows — so the user edits words instead of writing
them from nothing.

**Architecture:** A `NarrationProvider` interface with four interchangeable implementations,
chosen in settings, mirroring the existing `TTSProvider`/`sayTtsProvider` split. An evidence
layer turns a clip into the material a provider needs: a cleaned action log for recordings,
sampled frames for anything visual. Orchestration writes the result through the existing
transcript API inside `withHistory`, so a drafted narration is undoable like any other edit.

**Tech Stack:** Electron main process, Zod, ffmpeg (already shipped with
the app), `execFile` for the Claude CLI, `fetch` for Ollama and the Anthropic API.

## Global Constraints

- **Never overwrite words the user wrote.** Auto-draft only fills a clip with no narration, or
  one whose segment is still `status: 'draft'` and was itself agent-written. Manual redraft is
  explicit and confirmed.
- **The feature must work with nothing installed.** `template` is the default provider and has
  no dependency, no network and no cost.
- **A missing provider is a message, not a crash.** Every provider reports `isAvailable()`, and
  the UI says what to install.
- **No new runtime dependency.** Anthropic and Ollama are plain `fetch`; Claude is `execFile`.
- **Drafting is undoable.** All writes go through `withHistory`.
- **Nothing leaves the machine without the user choosing it.** `template` and `ollama` are local;
  `claude-cli` and `anthropic` must say plainly in settings that frames and logs are sent.

---

### Task 1: Settings store

**Files:** Create `src/main/settings/schema.ts`, `src/main/settings/settingsStore.ts`,
`src/main/settings/settingsStore.test.ts`; modify `src/main/ipc/projectHandlers.ts`,
`src/preload/index.ts`, `src/renderer/src/api/projectClient.ts`.

Settings live at `~/Talkie/settings.json`, beside `Projects/`, not inside any project — they are
the user's, not the demo's.

```ts
export const NarrationSettingsSchema = z.object({
  autoDraft: z.boolean().default(true),
  provider: z.enum(['template', 'claude-cli', 'ollama', 'anthropic']).default('template'),
  ollama: z.object({ baseUrl: z.string().default('http://127.0.0.1:11434'), model: z.string().default('llava') }).default({}),
  anthropic: z.object({ apiKey: z.string().default(''), model: z.string().default('claude-sonnet-5') }).default({})
})
```

`readSettings(baseDir)` returns defaults when the file is missing or unparseable — a corrupt
settings file must never stop the app opening. `updateSettings(patch, baseDir)` deep-merges and
writes atomically.

### Task 2: Clean the action log

**Files:** Create `src/main/agent/cleanActionLog.ts` + test.

The raw log is mostly noise (verified against real recordings: 63 entries, most of them failed
resource loads; one Google URL is 700+ characters). `cleanActionLog(entries, window)` must:

- drop every `console.error` — irrelevant to what the demo shows
- window entries to the clip, offsetting by `trimBefore` so times line up with the trimmed clip
- shorten a URL to host + path, keeping only a `q=` search term when present
- collapse consecutive navigations to the same URL (the recorder emits duplicates)
- keep `annotation` entries — these are the user's own "important/redo/skip" markers and are the
  strongest signal of intent in the whole log

### Task 3: Evidence for a clip

**Files:** Create `src/main/agent/clipEvidence.ts` + test.

```ts
interface ClipEvidence {
  kind: 'video' | 'image'
  durationSeconds: number
  actions: CleanAction[]   // empty for an image
  framePaths: string[]     // sampled stills; the image itself for an image clip
}
```

For a video, the session directory is `dirname(data.src)` and the log is `actions.jsonl` beside
it. Frames are sampled with `RenderInternals.callFf({ bin: 'ffmpeg' })` into a temp directory —
at most 4, evenly spaced across the clip, starting after `trimBefore`. For an image, the frame
list is just the image. Frames are cleaned up after the provider returns.

### Task 4: Provider interface + template provider

**Files:** Create `src/main/agent/narrationProvider.ts`, `src/main/agent/templateProvider.ts` + test.

```ts
export interface NarrationProvider {
  readonly id: string
  isAvailable(): Promise<boolean>
  draft(request: NarrationRequest): Promise<string>
}
```

The template provider is a pure function over evidence — no I/O, so it is exhaustively testable
and is the honest default: it turns navigations and clicks into plain sentences and says nothing
it cannot know. An image with no actions gets a neutral line naming its position in the demo.

### Task 5: Claude CLI provider

**Files:** Create `src/main/agent/claudeCliProvider.ts` + test.

`execFile('claude', ['-p', prompt, '--output-format', 'json'])`, parsing `result` out of the JSON.
Verified working on this machine (v2.1.267, authenticated, ~1.8s for a trivial prompt).
`isAvailable()` resolves the binary on PATH. Frame paths go in the prompt for the CLI to read.
Must have a timeout and must surface a non-zero exit as a readable error.

### Task 6: Ollama provider

**Files:** Create `src/main/agent/ollamaProvider.ts` + test.

`POST {baseUrl}/api/chat` with `images` as base64. `isAvailable()` is a short-timeout `GET
{baseUrl}/api/tags`, which also tells us whether the configured model is actually pulled — the
error must name the model and the `ollama pull` command to fix it.

### Task 7: Anthropic provider

**Files:** Create `src/main/agent/anthropicProvider.ts` + test.

`POST https://api.anthropic.com/v1/messages` with `fetch`, frames as base64 image blocks. No SDK
dependency. `isAvailable()` is simply whether a key is configured.

### Task 8: Orchestration

**Files:** Create `src/main/agent/draftNarration.ts` + test; modify `src/main/project/projectApi.ts`.

`draftNarrationForItem(projectId, itemId, { force }, baseDir)`:
1. refuse when the clip already has user-written narration and `force` is false
2. gather evidence, select the provider from settings, draft
3. write through `addTranscriptSegment`/`updateTranscriptSegmentText`, status `draft`
4. append a run record to the project's `agents/runs/` — provider, duration, outcome. That
   directory is already in `PROJECT_SUBDIRS` and has been unused until now.

### Task 9: Auto-draft on import

**Files:** Modify `src/main/capture/importRecordedSession.ts`, `src/main/ipc/*`.

When `settings.narration.autoDraft`, drafting starts after the clip lands, without blocking the
import. The renderer learns of it through a pushed event, the same way `sessionImported` already
works. A provider failure here is logged and shown once — never a dialog, never a crash.

### Task 10: UI

**Files:** Create `src/renderer/src/components/SettingsDialog.tsx`; modify `ClipNarrationBox.tsx`,
`Timeline.tsx`, `AppShell.tsx`.

- Settings dialog from the header: provider picker, availability state, auto-draft toggle,
  per-provider fields, and a plain sentence about what leaves the machine.
- "Draft" button on each clip's narration box, next to the mic.
- "Draft all" beside "Narrate all", counting only clips that need it.
