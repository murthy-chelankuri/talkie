# Talkie

Notes for anyone working on this repository, human or agent. This file is the canonical one;
`CLAUDE.md` is a symlink to it, and any other tool's instruction file should be too rather than a
second copy that drifts.

An Electron app that records a browser session silently, writes and speaks the narration, and
exports an MP4. macOS only, Apple Silicon. React + Remotion in the renderer, Playwright for
capture, `say` or the built-in Kokoro voice for speech.

## Commands

```bash
npm run dev          # electron-vite dev
npm test             # vitest, the whole suite (~55s, 93 files)
npm run typecheck    # both tsconfigs — node and web
npm run build        # electron-vite build + the MCP bundle
npm run package      # regenerates notices, builds, produces release/Talkie-<version>-arm64.dmg
npm run notices      # regenerates the third-party licence data
```

Run `npm test` and `npm run typecheck` before committing. Both are expected to pass.

A test that speaks through `say`, drives a browser or runs ffmpeg gets at least 60 seconds,
and 90 where it asks for a voice macOS has to fetch and warm up first. None of them are
testing the clock, and a limit close to the real cost turns the suite into a report on how
busy the machine is — which it did three times before they were all raised together.

The recording tests drive a real Chromium and run it headless, so a test run does not throw
windows in front of whatever else is on screen. `TALKIE_HEADLESS=0 npm test` shows them, which
is worth doing when a recording test misbehaves — the app itself is always headed, because the
person is the one driving that browser.

## Things that will bite you

These each cost real time to find. None are obvious from the code.

- **Main and preload must be CommonJS `.cjs`.** The package is ESM, but Electron cannot load an
  ES module from inside an asar archive — a packaged build starts, reports itself ready, and
  never opens a window. `electron.vite.config.ts` forces `format: 'cjs'` with a `.cjs` extension
  for both.
- **`react` is a runtime dependency, not a dev one.** `@remotion/renderer` requires it in the
  main process.
- **Electron's binary is fetched by a postinstall, and `npm run dev` checks for it first.**
  The package is a stub; without the download it throws "Electron failed to install correctly",
  which reads as a broken app rather than an unfinished install. `scripts/ensureElectron.mjs`
  fetches it and, failing that, names the three causes — `ignore-scripts` set globally, a
  github.com download a proxy refused, `ELECTRON_SKIP_BINARY_DOWNLOAD`. It is called from inside
  the `dev` script rather than as a `predev` hook on purpose: `ignore-scripts` skips pre and post
  hooks too, so the commonest cause would also disable the check for it.
- **Test the packaged build, not only `npm run dev`.** They differ in ways that have already
  caused silent failures. `process.cwd()` in particular is *not* the app directory once packaged —
  it is wherever the app was launched from, which is `/` from Finder. Use `__dirname`.
- **Anything that shells out has to be told where the binaries are**, through `ffOptions()` or
  `binariesDirectory()`. Remotion looks beside its own package, which once packaged is inside the
  asar archive where nothing can be executed. Every `callFf` call passed it; the two
  `getVideoMetadata` calls did not, so measuring a recording threw, the import's three-second
  placeholder stood in for the real length, and every packaged recording arrived on the timeline
  as three seconds of its opening. `packagedBinaries.test.ts` reads these off the source, because
  running them in the suite only ever exercises the checkout layout — the case that always worked.
- **Remotion is handed a browser too**, through `browserExecutablePath()`. Left to find its own
  it works out where to download one by walking up from the working directory looking for a
  package.json — from `/` there is none, so it settles on `/.remotion` and export dies with
  `ENOENT: mkdir '/.remotion'`. Both `selectComposition` and `renderMedia` need it; missing
  either fails in a packaged build and nowhere else. `exportFromAnywhere.test.ts` moves the
  working directory to `/` on purpose, because running from the checkout is the case that has
  always worked.
- **The composition is bundled at build time**, by `scripts/bundleRemotion.mjs` into `out/remotion`,
  and resolved from `__dirname` by `remotionBundle.ts`. Export used to bundle it on demand from
  `process.cwd()` + `src/`, and a packaged build has neither. The bundle is unpacked from the
  archive for the same reason mermaid is: a headless browser fetches those files, and only Node
  can read out of an asar.
- **Native binaries cannot load from inside asar.** Remotion's compositor, Playwright, and the
  MCP entry point are all in `asarUnpack`.
- **Kokoro runs in its own process, and must stay there.** `phonemizer` says Apache-2.0 but
  carries eSpeak NG (GPL-3.0) compiled inside it. Only `src/main/tts/kokoro/kokoroWorker.ts` may
  import `kokoro-js`, `phonemizer`, `@huggingface/transformers` or `onnxruntime-node`; the main
  process forks it and talks over IPC. `kokoroBoundary.test.ts` fails on any other import — a
  type-only one included. The worker is its own `electron.vite.config.ts` main entry, and those
  packages are in `asarUnpack` because ONNX Runtime and libvips are native.
- **`sharp` is a stub, on purpose.** transformers.js loads sharp at startup but Kokoro never
  processes an image, and the real one brings libvips — eight LGPL-3.0 libraries, MPL and a patent
  licence. `package.json` makes `stubs/sharp` a dependency and overrides `sharp` with `$sharp`
  (a `file:` path directly in `overrides` resolves relative to transformers.js and breaks a clean
  install). `licences.test.ts` fails if libvips reappears.
- **The worker ends by signal, not `process.exit`.** onnxruntime-node aborts during an ordinary
  exit on macOS ("mutex lock failed"); releasing the model first does not help.
- **transformers.js refuses to load with both model sources off**, even from a full cache. While
  speaking, its remote host is pointed at a dead local port instead, so a cached model loads and a
  missing one fails rather than downloading mid-clip.
- **The MCP server is an ES module, which has no `__dirname`.** The shared modules find what ships
  beside them through it — the Remotion bundle, the HTML scene runtime — so `vite.mcp.config.ts`
  defines `__dirname` and `__filename` in the bundle's banner. Without that, the built server threw
  a `ReferenceError` on the first lookup and nothing caught it, because the tests run the sources;
  `builtServer.test.ts` runs the built bundle from `/` once there is one.
- **esbuild is a build tool, not part of the app.** `htmlScene/resources.ts` builds the scene runtime
  on first use only in a checkout, and loads esbuild there and only there; a packaged build ships the
  runtime already built and has no esbuild to load.
- **Renderer entries are declared explicitly** in `electron.vite.config.ts` — the editor window
  and the recording toolbar. A new window needs adding there or it will not ship.

## Architecture

- `src/main/` — Electron main. Owns all file I/O, child processes, and network calls to model
  and speech services. IPC channels are named `project:*`, `settings:*` or `menu:*`; a test
  enforces that and that every channel has both a handler and a caller.
- `src/preload/` — two bridges: `index.ts` for the editor window, `toolbar.ts` for the recording
  toolbar (five calls, nothing more).
- `src/renderer/` — React. Reaches main only through `window.api`.
- `src/remotion/` — the composition. Shared by the preview and the export, so what is on screen
  is what renders.
- `src/mcp/` — a standalone MCP server, a **separate process**, off by default and token-gated.
- Projects live in `~/Talkie/Projects/<id>-<slug>/` as `project.json`, `timeline.json`,
  `transcript.json`, plus `audio/` and `sources/`. Settings are `~/Talkie/settings.json`, mode
  `0600`.

## Writing narration

Two surfaces, because they are two jobs. The timeline's `ClipNarrationBox` is sized by the
clip's width, which is fine for a glance and hopeless for writing — it hides the words entirely
below `NARRATION_TEXT_MIN_WIDTH`, and scene splitting made every clip narrower. `ScriptView` is
the other one: the whole project's narration top to bottom, in a column wide enough to read a
sentence in, because most of what is wrong with narration is only wrong in context.

**Timings live in the words.** A line beginning `[12.3]` is spoken at that second of its clip,
and `narrationFromText` reads them back on the way in — in the IPC handlers and in MCP, so every
route stores them the same way. Before that, editing narration anywhere cleared `beats` and
silently turned a timed take into one flat block.

## Asking the agent to change a project

It sits beside the video rather than in the script pane: what it changes is the project, not
only the words, and the stage already has the sources panel down one side — this is the other,
with the demo between them.

It reads as a conversation because it is one. Each turn passes the previous turn's
`session_id` back as `--resume`, so "make that shorter" knows what "that" was; a chat that
forgot between messages would be a worse lie than the single instruction box it replaced. The
conversation belongs to the project and starts again when another is opened.

`projectAgent.ts` runs one instruction against a whole project — "add an introduction and a
closing statement" — by lending the CLI provider the tools Talkie already exposes: it launches
`claude` with Talkie's own MCP server attached and `--strict-mcp-config`, so the in-app agent
and an outside agent are the same agent working through the same tools. There is no second
implementation to keep in step.

- **The switch still gates it.** Agent access off means the run is refused, exactly as for
  anyone else. What is new is `mcp.runTokenHash`: a second hashed slot so a run cannot revoke
  the token an outside agent is already holding. It is withdrawn in a `finally`.
- **`AGENT_TOOLS` is the reach.** Reading, project context, narration, every scene kind,
  arranging, and undo. Not recording and not exporting — both take minutes, and neither is what
  anyone means by "add an introduction".
- **Every kind needs all five verbs.** Create, read, modify, remove, place. Both agent bugs
  found in use were the same shape — create exposed, modify not: `add_scene` with no way to
  edit a slide, and no way to reorder. Adding a tool means checking the other four.
- **Mermaid needs a browser, and the server has one.** `renderMermaidHeadless.ts` draws a
  diagram in the same Playwright Chromium that records demos, so an agent's diagram is a
  picture immediately and a syntax error comes back to whoever wrote it. Both drawings go
  through `mermaidTheme.ts` — same config, same font, injected as a data URL because a headless
  browser has no fonts and mermaid sizes every box to the text in it. `drawPendingDiagrams` in
  the renderer is now only the net underneath.
- **Deck import does not.** `renderPdfPages.ts` rasterises in the renderer on Chromium's own
  canvas; `rasterisePdf.ts` does the same in Node for the MCP server, using the `@napi-rs/canvas`
  that `pdfjs-dist` already brings with it. Two implementations of one thing, deliberately: the
  window should not pay for a native canvas it does not need, and the server has no window. Both
  are in `asarUnpack` — the canvas is native, and plain `node` cannot read either from inside
  the archive.
- **The whole run is one undo step.** The agent writes from a child process whose own history
  dies with it, so `project:agent:instruct` wraps the run in a single `withHistory` on the app's
  side and the editor re-reads from disk afterwards. This is the documented no-locking hazard at
  its sharpest: nothing should write to the project while a run is going.

## Recording an app automatically

`exploreSession.ts` walks an app on its own when the user ticks "Show me round it", driven by
whichever narration provider is configured — it reads the page as text, because `complete()` has
no picture in it.

It stops when it thinks the demo is shown: the recording finishes on its own a few seconds
later, late enough to read the toolbar and take over by hand. A walk that ended because nobody
signed in, or because there was nowhere safe to go, leaves the recording running instead — those
need a person, and ending the recording would throw away the chance to carry on.

`authWall.ts` recognises a login or a second factor by asking `redact.ts` whether it would hide
the field. That is the same question from the other end — the fields whose values must never be
written down are exactly the ones only the user can fill — so the two cannot drift apart. The
walk then waits, up to five minutes, with the browser on screen for the person to sign in, and
carries on when the wall goes. Without that it finds nothing safe to click, concludes the app is
finished, and leaves a recording of a login screen with no explanation.

**The walk follows the page the recording is watching, not the one it started on.** That is the
whole of `session.watchedPage`, and `exploreSession.ts` takes it rather than a `Page` for the
same reason the video is cut by it: signing in is the one moment in a demo when the page being
looked at stops being the page that was there before. A provider window that does not close
itself leaves the app inside it; the walk that stayed pinned to the tab underneath read a login
screen nobody was standing at, held there for its full five minutes, and reported an app nobody
had signed in to. There is one answer to "which page is in front" and both sides ask for it.

A step reads and clicks the same page, resolved together at the top of the loop. A sign-in
therefore ends its step rather than carrying its reading on into a click — a selector is a mark
stamped on one page, and used against another it clicks whatever happens to hold that mark.
`signInResume.test.ts` drives the shapes end to end, as `signInRecording.test.ts` does for the
footage; they are separate files because the two broke separately and look identical from
outside, as a video that ends at a login screen.

**`safeToClick.ts` is the whole safety boundary, and it is an allowlist.** This runs unattended
against what may well be production: it may follow links that stay on the origin, tabs and menu
items, and buttons that are not inside a form; it refuses everything else, anything whose label
reads as a verb, and anything that would sign it out or sign it in. It never types and never
submits. Widening it is not a small change — a recording is the worst place to discover a click
did something, because by the time anyone watches the video the record is already gone.

Refusing the way *in* is what makes a wall a wall. "Continue with Google" opens a window the walk
cannot type into; `authWall.ts` calls a page a sign-in only when it asks for an identifier and
has nowhere to go, so one such button used to be enough for the page to count as somewhere to
get on to. It was never a wall, nobody was ever waited for, and the walk clicked the button.

## Narration drives the picture

A timed take is a list of moments, so the visuals can follow it rather than run on a stagger of
their own. `revealOnBeat.ts` turns beats into frames and both scene kinds use it: a slide brings
in each line as it is spoken, and `buildDiagram.ts` tags every mermaid node so a diagram is
drawn in the order it is explained rather than arriving whole.

- **Beats reach the composition through `resolveTimelineAssetUrls`**, alongside audio and
  captions. A clip with no timed take gets none, and both scenes fall back to what they did
  before — lines settling on a fixed stagger, a diagram shown complete.
- **Beats are matched to lines from the end.** A slide is nearly always introduced before its
  first point, so counting back puts each line with the sentence about it whether or not there
  is an opening beat.
- **An untimed slide never starts empty.** Lines settle from 0.7 rather than arriving from
  nothing, because the first frame of a slide is what every thumbnail shows.

## Themes

A theme is a company's look — three variants (brand, light, dark), fonts, logo, caption and click
colours — kept once in `~/Talkie/Themes` and chosen per project (`themeId`). `src/main/themes/`.

- **The composition gets a `RenderTheme`, with logo and fonts as data URLs.** Not asset-server
  URLs: that server is rooted at the projects folder, and widening it would put `settings.json`
  in reach. `toRenderTheme` builds it for the preview and the export alike.
- **Diagrams carry their colours**, so each records a `themeStamp`; stale ones are redrawn when
  the project opens and before export (`redrawStaleDiagrams`).
- **The first theme adds opening and closing cards, once** (`bookendsAdded`).
- **Built-in themes live in code** (`builtinThemes.ts`, ids `builtin-*`), not in the library folder,
  so they cannot be deleted or edited — `themeApi` refuses, and Duplicate gives an editable copy.
  They use only Geist and Newsreader, the fonts every render already has, so they work offline and
  bring no new licences; a test holds every colour to the contrast floors.
- **Agents reach all of it over MCP**: list, read, create (from a site, a logo or guide file, or a
  description), update — colours, fonts, logo — duplicate, delete, apply. A slide's `layout` and
  every scene's look (brand/light/dark) are settable, and `talkie_list_voices` names the voices of
  whichever engine Talkie is set to, since `talkie_set_voice` refuses one it does not have.
- **A diagram is painted on its look's own background.** `diagramStamp` carries a drawing version;
  raise it when how a themed diagram is drawn changes, or ones already drawn keep the old look.
- **Logos are drawn still, and plated where they would vanish.** Brand sites often serve animated
  SVG logos; CSS animation runs on the clock and Remotion renders frames out of order, so
  `stillLogo.ts` settles every animation into its end state when the theme is drawn (the file stays
  as published). `LogoMark` reads the logo's colours in the browser and, on a slide or card whose
  background would hide too much of it, puts it on a plate in the theme's light or dark colour.
- **No theme means the old look, exactly** — the old palette names still render as they did.
- **AI themes**: `generate/` reads the site headless (one page, no clicks), the narration
  provider chooses (rules if not), fonts come only from Google Fonts' `ofl/`/`apache/`, contrast
  is fixed, and the result waits in `Themes/.drafts` until saved.

## HTML scenes

A clip whose picture is a web page — HTML, CSS, JS — played frame by frame (`kind: 'html'`,
`src/main/htmlScene/`, `src/htmlScene/`). People describe one, start from a template, import a page,
or edit the code; agents use five MCP tools and get the frames back as images.

- **A scene is a revision folder** under `sources/html/`, never changed once written; `src` points
  at its page. Undo restores the pointer. Unreferenced revisions are swept when a project opens.
- **Talkie's runtime owns the page's time.** The asset server injects `talkie-runtime.js` first;
  it replaces the clock (rAF, timers, Date, performance.now) and answers each `seek` with `drawn`
  once every animation is held at that moment. CSS animations can be replaced by the browser after
  they are held, so it holds, paints and checks again.
- **The theme arrives as CSS variables** (`--talkie-bg`, `--talkie-heading`, …). No theme means
  Talkie's own look, as for slides; Talkie's fonts are served from `__talkie/fonts/`.
- **`checkHtmlScene` is the one check**, for the editor, posters and agents: it plays the scene in
  the headless host exactly as the video does and reports errors, sandbox attempts, off-theme
  colours, text out of frame, blank frames and order-dependent animation.
- **Libraries are anime.js, D3 and lottie-web only** — no GSAP (its licence forbids tools that
  compete with Webflow's animation builder).

## Security invariants

Do not weaken these without understanding what they are for. Each has tests.

- **`sanitiseRichText` rebuilds markup from an allowlist**; it never strips. Scene text reaches
  six `dangerouslySetInnerHTML` sites and does not only come from the user — the drafter, MCP
  tools and imported decks all produce it. A regex that required whitespace before attributes
  once let `<b/onmouseover=...>` through intact.
- **CSP is set as a response header** in `src/main/security/contentSecurityPolicy.ts`.
  `connect-src` is the important one: the renderer has no reason to reach the network, and
  `settings:read` hands it the API keys.
- **The asset server puts a per-run secret in every URL.** Loopback is not a boundary — any page
  in any browser can scan the ephemeral ports. CORS cannot be the control because the renderer is
  `file://` (origin `null`) and needs to sample video frames onto a canvas.
- **Permissions are deny-by-default**, in `src/main/security/permissions.ts`. Electron's list
  includes the camera, screen capture, the clipboard and location; this app needs the
  microphone and fullscreen. Anything added to that list upstream arrives refused. Written as a
  named rule rather than an inline comparison because the inline one silently cost the preview
  its fullscreen button.
- **HTML scenes play in `sandbox="allow-scripts"` frames and nothing more** — never
  `allow-same-origin`. Their pages are served with `connect-src 'none'` and images and fonts only from
  their own folder (`htmlScene/policy.ts`). A sandboxed frame can still navigate itself, carrying the
  asset server's secret in its address, and only the *framing* page's policy stops that: every host —
  the editor, the check's host page, and the export's composition — restricts `frame-src` to the
  asset server. DNS prefetching is turned off and WebRTC removed, since no page policy covers either.
  `check.test.ts` drives a hostile scene through every one of these.
- **No window enables `nodeIntegration`.** Navigation is confined to the app's own pages by
  `src/main/security/navigationGuards.ts`.
- **The MCP server is off by default** and checks a hashed token on every call.

## Known issue

`projectApi` mutations are read-modify-write over whole JSON files with **no locking**. That is
safe within the app — Node is single-threaded and the calls are synchronous — but the MCP server
is a separate process using the same functions. If an agent and the app touch a project at once,
one side's write silently overwrites the other's, and because `history` is per-process, undo in
one can discard the other's work. The fix under consideration is routing MCP tools through IPC so
the app stays the only writer.

## Licensing — read before distributing anything

- Talkie's own code is **Apache-2.0**. That covers this repository and nothing else.
- **Remotion is not open source.** Free for individuals, non-profits and companies of up to three
  people; larger for-profits need a paid licence. Cloning this does not grant one.
- **The ffmpeg inside Remotion's compositor is GPL-2.0-or-later** (`--enable-gpl`, x264, x265).
  It is not in this repository — `npm install` fetches it.
- Publishing *source* carries no GPL obligation. **Shipping a built `.dmg` does**, including
  offering ffmpeg's source to every recipient. That is why no prebuilt binaries are published
  here, and why the Mac App Store is not a route (App Sandbox also blocks `say`, `afconvert`,
  driving a browser, and the MCP server).
- **eSpeak NG, inside the Kokoro voice, is GPL-3.0** — the same distributor obligation as
  ffmpeg, and one open item: `phonemizer` does not say which eSpeak NG it compiled, which has to
  be settled before a build is published. The Kokoro weights are Apache-2.0 and are downloaded on
  first use, pinned and hash-checked, not shipped.
- **Licence texts no package carries live in `licences/`** — the GPL v2 and v3, and ONNX
  Runtime's MIT notice and ThirdPartyNotices — and are installed with the app. Replace the ONNX
  Runtime files when `onnxruntime-node` changes version; a test checks they match.
- See `NOTICE` and the in-app Settings → Licences screen, generated by `npm run notices`.

## Conventions

- **Comments say why, not what.** The codebase explains the reason a thing is the way it is,
  usually the failure that shaped it. Match that density and tone; do not narrate the code.
- **British spelling in user-facing text and in names** — colour, licence, sanitise.
- **Design tokens only**, from `src/renderer/src/styles/index.css`. The accent is azure
  (`#1a5fb4` light, `#7ab5f0` dark) and is used as text at 10–11px, so any change must be
  contrast-checked — the current floor is 5.8:1.
- **Tests describe behaviour, not implementation.** Names read as sentences about what the
  software does.
- Prefer `git worktree` for parallel work. Tool-managed worktree directories (`.claude/worktrees/`
  and the like) are gitignored.

## Workflow

`main` is the default branch and changes are meant to land through pull requests. Branch
protection is not enforced on the remote yet — GitHub requires a paid plan for private
repositories — so this is a convention for now, not a gate.

## Tool configuration

Instructions belong in this file. Anything specific to one tool — permissions, model choices,
hooks — belongs in that tool's own directory (`.claude/settings.json`, for instance), which is
committed so a checkout on another machine behaves the same. Per-machine and generated files
under those directories are gitignored; see `.gitignore` for which.
