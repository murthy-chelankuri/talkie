# HTML scenes — design

Date: 2026-10-10 · Branch: `feature/html-scenes` (stacked on `feature/themes`, PR #19)

## Goal

A scene can be anything a browser can draw. An **HTML scene** is a clip on the timeline whose
picture is a web page — HTML, CSS and JavaScript — played frame by frame in step with the video,
in the project's theme, timed to its narration. People make them by describing them, from a
template, by importing a page, or by editing code; agents make them over MCP and see the frames
they produced before anyone else does.

## Decisions (agreed in brainstorming)

| Question | Decision |
|---|---|
| Where HTML appears | **Full scenes only**, a clip like a slide or diagram. Overlays on other clips come later on the same engine. |
| What the code may do | **Full HTML/CSS/JS**, plus libraries Talkie bundles. Safety comes from the sandbox, not from limiting the code. |
| Ways in | All four: **agents over MCP**, **describe it in the app**, **edit the code in the app**, **import a file or folder**. |
| How it plays | **A live sandboxed iframe driven frame by frame** (approach A). Not pre-rendered to video; never inlined into the composition. |
| Why an iframe | It is the only thing that both keeps scene scripts away from the editor's `window.api` (and so the API keys) and gives the page a clock of its own to replace without stopping Remotion or the editor. |
| Theme | Honoured, not optional: colours of the scene's variant, fonts and logo arrive as CSS variables and `talkie.theme`, update live, and the check reports anything hard-coded instead. |
| Libraries | anime.js (MIT), D3 (ISC), lottie-web (MIT), plus CSS and the Web Animations API. **No GSAP**: its licence forbids use in tools competing with Webflow's visual animation builder. |
| Length | As for slides: follows the narration, or what was set. The page is told its duration. |

## 1. What a scene is, and where it lives

A new timeline kind, `html`, registered in `src/remotion/itemRegistry.tsx` beside `scene` and
`diagram`. Its data (zod `HtmlSceneDataSchema`, `src/main/project/timeline/schema.ts`):

```ts
{
  src: string,                 // absolute path of the entry page, inside a revision folder
  title: string,               // timeline label, MCP, narration drafting
  style: { theme: 'brand' | 'light' | 'dark' },   // the variant, as for slides
  params: Record<string, JsonValue>,  // named values the scene reads: { revenue: [12, 18, 31] }
  prompt?: string,             // what it was asked to show, kept for "make it faster"
  posterStamp?: string,        // theme + variant + content hash the poster was drawn for
  check?: CheckSummary         // the last check's problems, shown on the clip
}
```

On disk, one folder per scene:

```
<project>/sources/html/<revisionId>/
  index.html
  ...whatever it brings — images, fonts, Lottie .json, .js, .css
  poster.png                   // a still for the timeline thumbnail
```

A folder rather than a string in `timeline.json`: imports bring images and fonts, and code is easier
to edit and compare as files. Every save writes a new revision folder and the clip's `src` points into
it, so one save, one AI edit or one agent call is one undo step: undo restores the pointer, and
the old folder is still there. History stays two JSON files. Revisions nothing points at are swept
when the project opens, the one moment no undo can reach them. As `src` is a path like any other
clip's media, URL resolution and the repair of moved projects need nothing new.

**Allowed files** in a scene folder: `.html .css .js .mjs .json .svg .png .jpg .jpeg .webp .gif
.woff2 .woff .ttf .otf .txt`. At most 50 MB and 500 files per scene. Paths are checked to stay
inside the folder.

## 2. Serving and the sandbox

Scenes are served by the existing asset server (`src/main/render/assetServer.ts`), at their
project path under the per-run secret. For any `.html` response from a scene folder the server:

- **Inserts the runtime** — `<script src="<base>/__talkie/runtime.js"></script>` as the first
  child of `<head>` (creating `<head>` if the page has none), so it runs before the page's code.
- **Sets a policy of its own** (`Content-Security-Policy` response header):

```
default-src 'none';
script-src 'unsafe-inline' 'unsafe-eval' <scene folder URL> <base>/__talkie/;
style-src 'unsafe-inline' <scene folder URL> data:;
img-src <scene folder URL> data: blob:;
font-src <scene folder URL> data:;
media-src <scene folder URL> data: blob:;
connect-src 'none';
frame-src 'none'; worker-src blob:; object-src 'none';
form-action 'none'; base-uri 'none'
```

  `'unsafe-eval'` is there because lottie-web evaluates After Effects expressions and some
  agent-written code builds functions from strings; it gives nothing the sandbox does not already
  contain. `connect-src 'none'` is the one that matters: a page that cannot reach the network cannot send
  anything anywhere, even though its own URL carries the secret. Images and fonts are limited to
  the scene's own folder, so a scene cannot read another project's files either.

`__talkie/` is a fixed route mapped to the app's own resources (the runtime and bundled libraries),
not to the projects folder: `__talkie/runtime.js`, `__talkie/lib/anime.min.js`,
`__talkie/lib/d3.min.js`, `__talkie/lib/lottie.min.js`. Resolved from `__dirname`, so a packaged
build finds them from any working directory.

The iframe is `sandbox="allow-scripts"` — never `allow-same-origin`, `allow-popups`,
`allow-forms`, `allow-top-navigation` or `allow-modals`. The page gets an opaque origin: no access
to the parent, its storage, or `window.api`.

**The editor's policy** (`src/main/security/contentSecurityPolicy.ts`) changes in one place:
`frame-src 'none'` becomes `frame-src http://127.0.0.1:*`. Its test fails on anything wider.

## 3. The runtime: keeping a page in step with the video

`talkie-runtime.js` (built from `src/htmlScene/runtime/`) owns the page's time.

**What a scene can use** — `window.talkie`:

| | |
|---|---|
| `time`, `frame`, `duration`, `fps` | Where the video is, in seconds and frames |
| `params` | The scene's named values |
| `theme` | `{ background, heading, body, accent, fonts: { heading, body }, logo }` for its variant |
| `beats` | Seconds at which each line of its narration starts; `[]` with no timed take |
| `onFrame(fn)` | `fn(time)` runs for every frame; may return a promise |
| `ready(promise)` | Holds the first frame until loading is done |
| `anime(timeline)`, `lottie(animation)` | Hand a library animation to the runtime to be driven by frame |

**Theme as CSS variables** on `:root`: `--talkie-bg`, `--talkie-heading`, `--talkie-body`,
`--talkie-accent`, `--talkie-font-heading`, `--talkie-font-body`, `--talkie-logo` (a `url(...)`),
with the theme's `@font-face` rules injected and loaded before the first frame. A change of theme or
variant is sent to the page and applied live.

**The clock is replaced.** `requestAnimationFrame`, `cancelAnimationFrame`, `performance.now`,
`Date.now`, `new Date()`, `setTimeout`, `setInterval` and their clears run on video time inside the
scene. Time-based code ("100 px a second") lands on the same pixel on frame 120 however frame 120
is reached. Code that moves things a fixed amount per tick still cannot be made order-independent;
the check (section 6) finds it.

**Each frame**, the host posts `{ type: 'seek', frame, id }` and the runtime:

1. sets virtual time; runs due timers and queued animation-frame callbacks with that timestamp;
2. awaits every `onFrame` handler;
3. pauses every animation in `document.getAnimations()` (CSS animations, transitions, Web
   Animations) and sets its `currentTime`; seeks registered anime.js and Lottie animations;
4. awaits `document.fonts.ready` and the decoding of any image still loading;
5. waits for one real paint, then posts `{ type: 'drawn', id }`.

Messages the runtime sends unprompted: `ready`, `error` (uncaught errors, rejected promises, CSP
violations via `securitypolicyviolation`), each with a message and, where there is one, a line.

**Host side** — `src/remotion/items/HtmlScene.tsx`:

- renders the iframe at frame size; on load, posts `init` with fps, duration, params, theme,
  beats and the scene's variant;
- for each frame posts `seek`; **during export** holds the frame with `delayRender` until `drawn`;
  **in the live preview** nothing waits;
- a page that does not answer within **5 s** has its frame captured anyway and the error recorded
  — a broken scene never hangs an export;
- a page that fails to load renders a plain card with the scene's title in the theme, so the video
  still renders and the failure is visible.

## 4. Making and editing scenes in the app

**Add scene → HTML scene** offers three starts:

- **Describe it.** The configured provider's `complete()` writes `index.html` from the description,
  with a system prompt that carries the runtime API, the theme variables, the bundled libraries and
  the rules. The result is checked (section 6); if it has errors they are sent back once, as theme
  proposals already retry once.
- **Template.** Kinetic title, bar/line chart (D3), big-number counter, code walkthrough, before /
  after, Lottie player. Each uses the theme variables and `talkie.beats`. Shipped as files in
  `resources/html-templates/`.
- **Import** an `.html` file or a folder (section 1's limits). Script tags loading anime.js, D3 or
  lottie-web from a CDN are rewritten to the bundled copies; any other remote script, stylesheet or
  image is listed in a warning, since it cannot load.

**The scene editor** for `html` (a layout in `SceneEditor.tsx`):

- **Left:** CodeMirror 6 with a tab per text file in the folder; below it **Look** (Brand / Light /
  Dark), **Values** (a form for `params` — strings, numbers, booleans, arrays of numbers; anything
  else as JSON), and **Change with AI** ("make the bars grow one at a time"), which edits the
  current files through the provider and is checked like any other change.
- **Right:** the live preview with a scrubber, and the check's problems.
- **Save** writes the files, redraws the poster and is one undo step.

**Timeline thumbnail**: `poster.png`, rendered headless at 40% of the scene's duration and redrawn
when the files, the theme or the variant change (`posterStamp`, as diagrams have `themeStamp`).
Stale posters are redrawn on open and before export, alongside stale diagrams.

**Narration**: the drafter receives the scene's title, its prompt and the visible text of the
poster frame (read during the poster render). Beats reach the page as `talkie.beats`, through
`resolveTimelineAssetUrls`, as they reach slides and diagrams.

## 5. MCP

All five verbs, per AGENTS.md:

| Tool | |
|---|---|
| `talkie_html_scene_guide` | The runtime API, theme variables, libraries, the rules, and a short example. Read-only. |
| `talkie_add_html_scene` | `projectId`, `title`, and either `files` (path → contents) or `path` (an absolute file or folder to import); optional `params`, `style`, `durationSeconds`, `position`, `prompt`. |
| `talkie_html_scene` | Files, params, look, prompt and the last check. |
| `talkie_edit_html_scene` | Replace or add `files`, `removeFiles`, and change `params`, `title`, `style`. Only what is given changes. |
| `talkie_check_html_scene` | Render the frames asked for (`atSeconds`), defaulting to start, each beat, and end. |
| Remove / place | The existing `talkie_delete_clip` and `talkie_move_clip`, which handle every kind. |

Add, edit and check all return the check and **the frames as MCP image content**, so the agent
sees what it made. All of them join `AGENT_TOOLS`.

## 6. The check

`checkHtmlScene(projectId, sceneId, { atSeconds? })` in `src/main/htmlScene/check.ts`, in the
Playwright Chromium the recorder and diagram drawing already use, serving through an asset server
(the MCP process starts its own). One function for the app and for MCP. It reports:

| | |
|---|---|
| **Runs** | Load failure, uncaught errors, rejected promises, frames not drawn within 5 s |
| **Sandbox** | Each blocked request or forbidden access, by URL or API |
| **Theme** | Visible text or shapes whose computed colour is not one of the variant's four, or whose font is not the theme's — "headings use #ff0000; the theme's heading colour is `var(--talkie-heading)`" |
| **Fits** | Text overflowing the frame; frames that are a single colour |
| **Holds still** | The middle frame rendered cold, and again after rendering the frames before it in order; pixel difference above a small threshold is reported as order-dependent animation |

Problems are summarised into `check` on the clip, shown in the editor and on the timeline.

## 7. Testing

- **Sandbox** — a hostile scene that tries `window.parent`, `window.top.api`, `localStorage`,
  `fetch('https://example.com')`, an outside `<img>`, `window.open`, a form submit and
  `location = ...`; every attempt fails, and each is reported by the check.
- **Editor policy** — `frame-src` allows the asset server and nothing wider.
- **Determinism** — the same scene exported twice gives identical frames; frames rendered out of
  order match frames rendered in sequence (CSS, Web Animations, anime.js, Lottie, rAF, timers).
- **Theme** — changing the theme or variant changes the rendered scene; the check flags a
  hard-coded colour and is silent for one taken from a variable.
- **Robustness** — a page that never answers still exports, with its error recorded; a page that
  fails to load renders the fallback card.
- **Packaged** — an export with an HTML scene from working directory `/` finds the runtime and
  libraries (`exportFromAnywhere`-style).
- **Import** — CDN copies of bundled libraries are rewritten; other remote resources are listed;
  files outside the allowlist, oversized folders and paths escaping the folder are refused.
- **MCP** — each tool, including image content in replies and refusal of a relative `path`.

## 8. Licensing and packaging

- anime.js (MIT), D3 (ISC), lottie-web (MIT) and CodeMirror 6 (MIT) added; `npm run notices`
  regenerated. No GSAP.
- Runtime, libraries and templates ship in the build output and are resolved from `__dirname`.
  Only the asset server reads them — it is Node, which can read inside the asar archive — and every
  browser (preview, export, check) fetches them from it over HTTP, so none needs `asarUnpack`.

## Not in this version

- HTML as an overlay on other clips — next, on the same runtime.
- Sound from scenes — scenes are muted; narration and music come from the timeline.
- Interaction — no clicking or typing into a scene.
- 3D (three.js / WebGL) — headless WebGL renders unevenly; not bundled, not promised.
- Loading anything from the network.
