# Talkie

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
- Prefer `git worktree` under `.claude/worktrees/` for parallel work; it is gitignored.

## Workflow

`main` is the default branch and the intent is that changes land through pull requests. Branch
protection is not enforced on the remote yet — GitHub requires a paid plan for private
repositories — so this is a convention for now, not a gate.
