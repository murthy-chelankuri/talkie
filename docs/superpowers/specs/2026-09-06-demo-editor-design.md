# Demo Editor — Design Spec

Date: 2026-09-06
Status: Approved for planning

## 1. Purpose & scope

A macOS desktop application for developers to record demos of features they've
built and turn them into narrated MP4 videos. The app is a real, human-driven
video editor first; AI assists specific jobs (transcript drafting, narration,
QA) as pluggable agents rather than driving the whole process autonomously.

Out of scope for v1: interactive/clickable HTML exports, Windows/Linux
support, multi-user/collaboration, cloud sync. These are plausible future
extensions but are not designed here.

## 2. Goals

- A developer can: create a project, record a browser session, import images
  and PowerPoint slides, get an AI-drafted transcript, edit it, and export an
  MP4.
- Projects live on disk as self-contained folders and can be closed and
  resumed later with no separate "resume" mode.
- The system is expandable along three axes without touching core engine
  code: new AI agents, new capture sources, new timeline effects/items.
- Preview in the editor and the final export are the same rendering code —
  no drift between what the user sees while editing and what gets exported.

## 3. Architecture overview

Electron app, two processes:

- **Main process** (Node/TypeScript): owns the filesystem, spawns Playwright
  for capture, spawns/embeds the Remotion renderer for export, runs the agent
  host (a self-owned, provider-agnostic tool-use loop — see §8), and exposes
  all of this to the renderer as a typed `ProjectAPI` over IPC.
- **Renderer process** (React): the editor UI — project browser, timeline,
  transcript panel, `@remotion/player` for live preview.

There is no backend server and no embedded database. A project is a folder of
JSON + media files (see §4). Both the human editing through the UI and any
agent acting on a project call the **same `ProjectAPI`** — an agent cannot do
anything a human couldn't do by clicking, and every mutation goes through one
code path.

### Core extension interfaces

These four interfaces are what make the system expandable; each is a
TypeScript interface plus a registry loaded at startup. Adding a new
implementation never requires changing the registry or engine code.

| Interface | Purpose | v1 implementation(s) | Future examples |
|---|---|---|---|
| `CaptureSource` | Produces timeline clips + an action log | Playwright browser session | Terminal recording, native screen capture, video file import |
| `TimelineItem` (`kind`) | A schema + Remotion component + optional canvas overlay | `clip`, `image`, `slide`, `callout`, `caption`, `zoom`, `music` | `lower-third`, `intro`/`outro` branding |
| `Agent` | A named, tool-scoped AI job | `transcript-writer` | `scene-splitter`, `qa-pass`, `translator` |
| `TTSProvider` | Swappable narration backend | macOS `say` (default), pluggable ElevenLabs/OpenAI | Any future TTS vendor |
| `LLMProvider` | Swappable model backend for agents | Anthropic (native), OpenAI-compatible (covers OpenAI + local/hosted servers) | Google, or any other native integration |

### Compositor

Rendering (both live preview and final export) is implemented with
**Remotion**: every `TimelineItem.kind` has a matching React component, and
`timeline.json` is the single composition both `@remotion/player` (preview)
and `@remotion/renderer` (export) read. This guarantees preview/export
parity by construction.

This is implemented behind a narrow `Compositor` interface
(`renderFrameRange`, `renderToFile`) rather than called directly, so the
render backend can be swapped later (e.g. if Remotion's licensing terms stop
fitting the team, seat count, etc.) without touching timeline data, effect
schemas, or the editor UI.

Known trade-off, accepted for v1: Remotion renders by driving headless
Chrome frame-by-frame, so export is noticeably slower than a native
ffmpeg-filtergraph pipeline. This is acceptable because it removes an entire
class of preview/export-drift bugs and because export runs in the
background, not blocking editing.

## 4. Project storage & data model

Projects live under `~/DemoStudio/Projects/<project-id>-<slug>/`:

```
project.json            # metadata: id, name, created, schemaVersion
timeline.json           # ordered TimelineItem[] — read by editor and renderer
transcript.json         # segments: {id, text, timelineItemId, audioFile, status}
sources/
  session-<id>/
    video.webm           # Playwright recording
    actions.jsonl         # timestamped action log
  images/
  slides/                 # extracted PPT slide images + speaker notes
audio/
  <segmentId>.mp3          # TTS-rendered per-segment narration
renders/
  draft-<timestamp>.mp4
  export-<timestamp>.mp4
agents/
  runs/<runId>.json        # full trace of an agent run: input, tool calls, output
```

Design rules:

- A project is nothing but files — copyable, zippable, diffable. No embedded
  database.
- `project.json.schemaVersion` is present from v1. Opening a project checks
  and migrates the schema if the app's format has moved on; this is the
  mechanism that makes "load a project from disk and resume" reliable
  long-term rather than just working by accident on day one.
- `timeline.json` is the single source of truth for both the live editor and
  the exported video.
- All writes through `ProjectAPI` are atomic (write to a temp file, rename
  over the target) so a crash mid-write cannot corrupt a project file.
- Opening a project and resuming a session are the same code path: read
  `project.json`, migrate if needed, lazily load the rest as panels open.
  There is no separate "resume" feature to build or maintain.

### Timeline item schema

```ts
type TimelineItem = {
  id: string
  kind: "clip" | "image" | "slide" | "callout" | "caption" | "zoom" | "music"
  start: number      // in composition frames
  duration: number   // in composition frames
  data: Record<string, unknown>   // validated by that kind's registered Zod schema
}
```

Each registered `kind` supplies three things: a Zod schema (validates the
item and auto-generates its property-panel form), a Remotion component
(render), and optionally a canvas-overlay controller (for direct
manipulation on the preview, e.g. dragging a callout's arrow endpoint).
Adding a new effect is: one schema, one component, no changes to the
timeline engine or editor chrome.

## 5. UI layout

Single main editor window, "classic NLE" layout (validated with the user via
mockup):

- **Left rail**: project sources (recorded sessions, imported images/slides)
  and installed agents with live status (idle / running / done / needs
  review).
- **Center**: `@remotion/player` preview.
- **Top-right**: transcript panel — one editable text block per segment,
  each linked to a timeline item.
- **Bottom, full width**: the timeline — drag to move, drag-edge to trim,
  click to select and open a generated property panel for that item.

All editing happens through this UI. `timeline.json` and `transcript.json`
are save-file formats, analogous to a `.psd` or `.fcpxml` — the user never
views or edits them directly:

- **Transcript editing**: click into a segment, edit inline. On edit
  (debounced) the segment is marked dirty; only dirty segments re-synthesize
  audio (§7). Segments can be split/merged/reordered via drag or a
  right-click menu.
- **Timeline editing**: standard drag/trim/select interactions. A selected
  item's property panel is generated from its `kind`'s Zod schema (text →
  input, number → slider, enum → dropdown, region → drawn directly on the
  preview canvas, e.g. a zoom target).

## 6. Capture pipeline

Recording launches a Playwright-controlled Chromium instance and records
video via CDP, alongside a page-injected listener that writes a structured,
timestamped action log:

```jsonc
{"t": 4231, "type": "click", "selector": "button#add-to-cart", "text": "Add to Cart"}
{"t": 4890, "type": "navigation", "url": "/cart"}
{"t": 6120, "type": "input", "selector": "input#promo", "value": "[redacted-if-sensitive]"}
{"t": 9500, "type": "console.error", "text": "..."}
```

This log — not the video frames — is what the Transcript Agent reads
(cheap, precise text rather than vision-based guessing), and it also drives
automatic chapter markers.

- A small always-on-top recording toolbar (separate window from the
  captured page) lets the developer mark moments live: important, redo,
  skip. These are written into the action log as annotations so a bad take
  doesn't require rewatching the full recording to locate.
- On stop: video + action log are saved to `sources/session-<id>/`. An
  auto-cut step splits the video into candidate clips at navigation
  boundaries and creates matching `TimelineItem`s in the source library, but
  never writes into `timeline.json` directly — capture populates the
  library; the user places clips on the timeline.

### Import (images & PowerPoint)

- **Images**: added directly as `image` timeline items with a configurable
  default duration, placed in the source library for the user to drag onto
  the timeline.
- **PowerPoint (.pptx)**: each slide is rendered to a PNG at the project's
  export resolution (via a headless LibreOffice conversion, the standard
  approach for high-fidelity PPTX rendering without reimplementing PPTX
  layout) and added as a `slide` timeline item. Speaker notes, if present,
  are extracted and passed to the Transcript Agent as suggested narration
  text for that slide, the same way action-log entries seed narration for a
  clip.

## 7. Transcript & TTS pipeline

1. On capture completion, the **Transcript Agent** runs automatically,
   reading the action log (and slide notes, if any) and writes one draft
   segment per meaningful action/chapter, each linked to a `timelineItemId`.
2. The user edits segments in the transcript panel. Each segment has a
   `status`: `draft` → `edited` → `narrated`.
3. On edit (debounced) or an explicit "Narrate" action, the segment text is
   sent to the active `TTSProvider`, producing `audio/<segmentId>.mp3`. The
   linked timeline clip's duration adjusts to fit the narration length,
   using a per-project pacing setting (stretch vs. hold-frame padding) —
   not hardcoded per clip.
4. Only dirty segments re-synthesize; editing one segment never re-runs TTS
   for others.
5. The narrator voice (provider + voice id) is a single project-level
   setting, not per-segment, so switching narration voice mid-project is a
   deliberate, visible action rather than an accident.

## 8. Agent system

One agent host in the main process runs a self-owned, provider-agnostic
tool-use loop (send messages + tool definitions to the configured
`LLMProvider` → execute any requested tool calls against `ProjectAPI` →
append results → repeat until the model returns a final answer). This is
deliberately not tied to any single vendor's agent framework, since model
choice (§ below) is a first-class, per-agent setting rather than a fixed
dependency.

Each agent is a manifest:

```ts
{
  name: "transcript-writer",
  trigger: "manual" | "on-capture-complete",
  inputSchema: z.object({ sessionId: z.string() }),
  allowedTools: ["readActionLog", "readTimeline", "writeTranscriptSegment"],
  systemPrompt: "...",
  defaultModel: "project-default" | { provider: string; model: string }
}
```

`allowedTools` are handles into the same `ProjectAPI` the UI calls — an
agent can never perform an action a human couldn't perform by clicking.
Every run is logged in full to `agents/runs/<runId>.json` (input, provider +
model used, every tool call and result, final output), making a bad AI edit
diffable and every run re-playable and re-runnable rather than a black box.

### Model configuration

- A project has a **default provider + model** (e.g. "Anthropic: Claude
  Sonnet" or "Ollama: qwen2.5-coder:32b"), set once in project settings.
- Each agent can **override** the project default in its own settings —
  e.g. running the transcript writer against a local model for privacy
  while a future QA pass uses a stronger hosted model.
- Two `LLMProvider` implementations ship in v1:
  - **Anthropic** — native Messages API.
  - **OpenAI-compatible** — one client implementation covering anything
    that speaks the OpenAI chat-completions + tools protocol: OpenAI
    itself, local servers (Ollama, LM Studio, vLLM), and hosted
    aggregators (OpenRouter, Groq, Together). This is the mechanism that
    satisfies "most frontier models including local hosted models"
    without a bespoke integration per vendor.
- The model picker in settings shows a **tool-calling support hint**
  (`supports tools: yes / no / untested`) per model, since this varies
  widely across local models. An agent assigned a model with no tool
  support automatically degrades to a plain single-shot prompt (no tool
  calls) rather than failing at run time — a documented limitation of that
  model choice, not a crash.

- **Transcript Agent** (v1, runs automatically on capture completion):
  drafts the transcript as described in §7. Writes directly since there is
  nothing to conflict with on a first pass.
- **Future agents (same contract, not built in v1)**: a scene-splitter that
  proposes clip boundaries, a QA pass that receives `renderPreviewFrame` +
  `readTimeline` tools and flags dead air or jarring cuts as timeline
  annotations, a translator that produces alternate-language transcript
  variants. Any agent beyond the first draft proposes changes as a
  reviewable diff rather than writing directly — the user accepts or
  rejects before it lands in `timeline.json`/`transcript.json`.
- Agents surface in the left rail with a live status (idle / running / done
  / needs review); clicking a completed run shows its proposed changes
  before they're applied.

## 9. Error handling

- **Capture failure** (Playwright crash, page navigation error): the
  in-progress session is preserved up to the last successful state; the
  source item is marked errored in the library rather than silently
  discarded, and the project itself remains fully usable.
- **Render failure**: partial render output is kept for inspection; the
  export panel surfaces the ffmpeg/Remotion error and log tail rather than a
  bare "failed" message.
- **Agent failure**: the run is marked failed in `agents/runs/`, with the
  full tool-call trace preserved for debugging. Because agents write via the
  same atomic `ProjectAPI`, a failed run cannot leave partial/corrupt writes
  in `timeline.json` or `transcript.json`.
- **TTS failure**: the affected segment stays in its current status with no
  audio and a retry affordance in the UI; other segments are unaffected.

## 10. Testing strategy

- **`ProjectAPI` and schema validation/migration**: unit tests, including a
  fixture project on an old `schemaVersion` to verify migration.
- **Timeline items**: golden-frame tests — render each `kind` at a few known
  prop states to a PNG and diff against a stored reference, catching visual
  regressions in effects.
- **Capture**: an integration test drives Playwright against a small local
  fixture HTML page (not the live internet) and asserts on the resulting
  action log shape.
- **Agents**: tested against recorded fixture tool-call traces rather than
  live LLM calls in CI, so agent-prompt changes don't make the test suite
  flaky or costly.

## 11. Open questions for the implementation plan

None blocking — the items below are sequencing decisions for the
writing-plans phase, not open design questions:

- Order of build: the natural walking skeleton is project
  create/save/resume → capture → timeline/preview (Remotion) → transcript
  editing → TTS → export, with the Transcript Agent as the first agent once
  the `ProjectAPI` and action log exist.
- Exact LibreOffice invocation and packaging (bundled vs. requiring a local
  install) is an implementation detail to resolve during planning, not a
  design fork.
