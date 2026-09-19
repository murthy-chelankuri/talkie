# Talkie

Notes for anyone working on this repository, human or agent. This file is the canonical one;
`CLAUDE.md` is a symlink to it, and any other tool's instruction file should be too rather than a
second copy that drifts.

An Electron app that records a browser session silently, writes and speaks the narration, and
exports an MP4. macOS only, Apple Silicon. React + Remotion in the renderer, Playwright for
capture, `say`/OpenAI for speech.

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
- **Test the packaged build, not only `npm run dev`.** They differ in ways that have already
  caused silent failures. `process.cwd()` in particular is *not* the app directory once packaged —
  it is wherever the app was launched from, which is `/` from Finder. Use `__dirname`.
- **Native binaries cannot load from inside asar.** Remotion's compositor, Playwright, and the
  MCP entry point are all in `asarUnpack`.
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

**`safeToClick.ts` is the whole safety boundary, and it is an allowlist.** This runs unattended
against what may well be production: it may follow links that stay on the origin, tabs and menu
items, and buttons that are not inside a form; it refuses everything else, anything whose label
reads as a verb, and anything that would sign it out. It never types and never submits. Widening
it is not a small change — a recording is the worst place to discover a click did something,
because by the time anyone watches the video the record is already gone.

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
