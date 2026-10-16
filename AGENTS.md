# Talkie

Notes for anyone working on this repository, human or agent. This file is the canonical one;
`CLAUDE.md` is a symlink to it, and any other tool's instruction file should be too rather than a
second copy that drifts.

An Electron app that records a browser session silently, writes and speaks the narration, and
exports an MP4. macOS only, Apple Silicon. React in the renderer, drawn and exported by Talkie's
own renderer (`src/video/`), Playwright for capture, `say` or the built-in Kokoro voice for speech.

## Commands

```bash
npm run dev               # electron-vite dev
npm test                  # vitest, the whole suite (~55s, 93 files)
npm run e2e               # builds, then drives the built app end to end (~2 min)
npm run e2e:long          # the long run: Kokoro narration, every example exported, a fresh clone (~30 min)
npm run examples:rebuild  # remakes the shipped examples from their scripts (~2 min, needs Kokoro)
npm run typecheck         # both tsconfigs — node and web
npm run build             # electron-vite build + the MCP bundle
npm run package           # regenerates notices, builds, produces release/Talkie-<version>-arm64.dmg
npm run notices           # regenerates the third-party licence data
```

Run `npm test` and `npm run typecheck` before committing. Both are expected to pass. The git
hooks in `.githooks/` hold you to it — `npm install` points git at them. Before a commit: the
types and the tests related to the staged files (seconds). Before a push: the types, the whole
suite, and `npm run e2e` (a few minutes). `--no-verify` skips them once; it is not a habit.

`npm install` also fetches the pinned ffmpeg and ffprobe into `vendor/ffmpeg/`
(`scripts/fetchFfmpeg.mjs`); `npm run dev` checks they are there.

**The end-to-end run** (`e2e/`) exists because every change that broke something passed the
tests nearest to it and broke a flow somewhere else: a Speak button that did nothing, Copy
buttons refused a permission, a Kokoro take with its first sentence missing. Each was only
visible in the built app. The run starts `out/` with Playwright against a throwaway `HOME` — a
fixture project built through `projectApi`, never the person's own projects or their settings,
which hold API keys — and checks what lands on disk as well as what is on screen: takes are
measured for silence (`e2e/audio.ts`), the export for length and a soundtrack. Kokoro borrows the
model already downloaded and is skipped where there is none. Any error the window logs fails the
test, so an error that is always there is a bug to fix, not noise to filter. When something
breaks in a way the run missed, add the flow to it.

It plays the shipped examples rather than only the fixture, because the bugs that got through were
all in shapes only real projects have: a take that ends before its clip (the preview went round
its first scene for ever), an HTML scene after a slide, a recording cut into scenes. It crosses
every kind of cut in every example — slide to video, video to diagram, and so on — and fails on
the playhead going back, stopping short, or a voiced clip playing no narration. It also starts the
app behind a proxy that refuses Hugging Face (`e2e/proxy.e2e.ts`): the proxy being asked is the
proof the download uses the network the browser does.

**The long run** (`e2e/long/`, `npm run e2e:long`) is what takes minutes rather than seconds, so it
is not in the push hook: run it before a release and after changing speech, export or setup.
Several scenes of long narration spoken in Kokoro and exported, with every scene measured in the
video's own soundtrack — a take on disk and a silent scene in the export were once both true;
every example exported whole, at its full length, voiced where it has narration; and a fresh clone
taken through `npm ci`, the build and an export, which is the only place install scripts run.

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
- **`react` is a runtime dependency, not a dev one**, though only bundles import it. React ships
  inside the renderer and the export page, and the Licences screen lists production dependencies
  (`generateNotices.mjs`): moved to devDependencies it would still ship, uncredited.
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
- **ffmpeg and ffprobe are reached only through `src/main/media/`.** They are pinned builds
  (`scripts/ffmpegBuilds.json`, GPL-3.0, nothing nonfree — `ffmpeg-static`'s macOS build calls
  itself not redistributable, and `ffprobe-static`'s Apple Silicon binary does not run), fetched
  into `vendor/ffmpeg/<platform>-<arch>/` and packaged into `Resources/ffmpeg/` as extraResources.
  `toolPath()` finds them from its own folder — the path up to `app.asar`, or up to the checkout
  — never the working directory and never `process.resourcesPath`, which the MCP server does not
  have. It used to be every call site's job: one `getVideoMetadata` call was never told where the
  binaries were, and every packaged recording arrived as three seconds of its opening.
  `mediaBoundary.test.ts` fails on any other way in. Encoders come from `h264()`'s table per
  system, hardware only: recording and export both encode with `h264_videotoolbox`.
- **The export is handed a browser** through `browserExecutablePath()`, as an absolute path. Left
  to find one itself, a renderer works out where by walking up from the working directory — from
  `/` there is nothing, and the renderer Talkie used to export with died there with an `ENOENT`
  from `mkdir`. `exportFromAnywhere.test.ts` moves the working directory to `/` on
  purpose, because running from the checkout is the case that has always worked.
- **Export renders in Chrome's headless shell, not a full Chrome.** A full Chrome holds some
  frames for 300–750ms each whatever the scene, so more tabs, the GPU or fewer pixels all
  changed nothing and a 55-second demo took three minutes; the shell does it in under one.
  `browserExecutablePath()` finds the shell Playwright installs beside its Chromium and falls back
  to the installed browser. An export's browsers are its own processes: quitting mid-export left
  them running with no parent, so `before-quit` cancels exports and waits (`exportJob.ts`).
- **The export draws frames in headless tabs and pipes their screenshots to ffmpeg.**
  `exportVideo.ts` draws the composition in N tabs, screenshots each frame over CDP and pipes the
  shots to one ffmpeg a tab (`render/exporter/`). Before the previous renderer was removed it was held
  to that renderer's output frame for frame, and four things it needed each cost real time to find.
  Recording frames are served as **PNG, not JPEG** (`frameSource.ts`, `assetServer.ts`) — the
  exact pixels, with none of the chroma a saturated brand loses to JPEG. Each composition frame is
  matched to the recording frame **showing at its moment, by time**: a recording is 25 fps under a
  30 fps composition *and* opens at a PTS a frame in, not zero (`probe.ts` reads `start_time`), and
  `-ss` alone overshot the frame by one often enough to show a later picture mid-animation, so the
  frame is landed on with `-copyts` and a PTS `select`. Screenshots are JPEG at **quality 80**,
  which kept the 4:2:0 ringing on a saturated edge the size the previous renderer's export had. The soundtrack
  is padded up to a whole AAC frame, or the container ends a frame short of the picture
  (`soundtrack.ts`).
- **The export page is built at build time**, by `scripts/bundleExportPage.mjs` into
  `out/export-page`, and found from `__dirname` (`exporter/exportPage.ts`). A packaged build has no
  `src/` to build it from on demand. It is unpacked from the archive for the same reason mermaid
  is: a headless browser fetches those files, and only Node can read out of an asar.
- **Native binaries cannot load from inside asar.** Playwright and the MCP entry point are in
  `asarUnpack`.
- **Kokoro runs in its own process, and must stay there.** `phonemizer` carries eSpeak NG
  (GPL-3.0) compiled inside it. Only `src/main/tts/kokoro/kokoroWorker.ts` may
  import `kokoro-js`, `phonemizer`, `@huggingface/transformers` or `onnxruntime-node`; the main
  process forks it and talks over IPC. `kokoroBoundary.test.ts` fails on any other import — a
  type-only one included. The worker is its own `electron.vite.config.ts` main entry, and those
  packages are in `asarUnpack` because ONNX Runtime and libvips are native.
- **`sharp` is a stub, on purpose.** transformers.js loads sharp at startup but Kokoro never
  processes an image, and the real one brings libvips — eight LGPL-3.0 libraries, MPL and a patent
  licence. `package.json` makes `stubs/sharp` a dependency and overrides `sharp` with `$sharp`
  (a `file:` path directly in `overrides` resolves relative to transformers.js and breaks a clean
  install). `licences.test.ts` fails if libvips reappears.
- **`phonemizer` is Talkie's own build, on purpose.** npm's ships an eSpeak NG with no known
  source, which makes it impossible to distribute under the GPL. `packages/phonemizer` is the same
  wrapper around eSpeak NG built from a pinned commit, overridden in the way `sharp` is; its
  `BUILD.md` says how to rebuild it (Emscripten, about a minute) and why that commit. The app loads
  `dist/phonemizer.cjs`, because the Kokoro worker is CommonJS. `phonemizer.test.ts` holds it to
  the phonemes npm's produced, so a rebuild that changes how Kokoro speaks fails. kokoro-js's
  `kokoro.web.js` bundles npm's copy whole and is left out of the app in `electron-builder.yml`.
- **Kokoro sometimes reads a line as pure silence.** One sentence in one voice at one speed came back
  as seconds of zeros every time, and 2% faster read perfectly — a fault in the model, not the
  words. It was saved as the take, and a scene lost its first sentence. `audibleTake.ts` checks
  every take from the file the worker wrote, asks again a shade faster or slower, and errors with
  the words if all of them are silent. That only catches a take silent all through: a long take is
  read in pieces (below), and in af_alloy four sentences in ten came back silent, so an
  eighty-second take had fifty seconds of nothing and passed. The worker checks each piece too, at
  the speeds `retrySpeeds` sends it. And "Speak N clips" carries on past a clip that fails
  (`narrateEach.ts`) — stopping there left every later scene, and the export, without a voice.
- **Kokoro reads 510 phonemes at a time and drops the rest without a word.** About 25 seconds of
  speech; a longer clip came back with its last sentences missing. The worker reads a take that
  fits in one go, as before, and cuts only one that does not — at sentence ends, then commas —
  measured with the same phonemizer (`PHONEME_BUDGET` in `kokoroWorker.ts`).
- **The worker ends by signal, not `process.exit`.** onnxruntime-node aborts during an ordinary
  exit on macOS ("mutex lock failed"); releasing the model first does not help.
- **transformers.js refuses to load with both model sources off**, even from a full cache. Its
  remote host is pointed at a dead local port instead, so a cached model loads and a missing one
  fails rather than downloading.
- **The Kokoro voice is downloaded by the main process, through Electron's `net.fetch`**
  (`kokoroDownload.ts`), never by the worker. Node's own `fetch` ignores the Mac's proxy settings
  and the keychain, so on a corporate network — a proxy, and a root certificate it re-signs HTTPS
  with — it failed where the browser worked. Chromium's network stack uses both. Each file is
  checked against `KOKORO_FILES` as it lands; the worker only loads what is already on disk.
- **The Kokoro voice can be brought in by hand**, for a proxy that will not let the app reach
  Hugging Face (`kokoroManual.ts`). `KOKORO_FILES` pins all four files the model is — size and
  SHA-256 — and is the one list the download check, the hand-copy check, the import and the
  instructions all read. The import recognises chosen files by their contents, never by name:
  browsers rename what they save, and a proxy's "blocked" page arrives under the right name.
  Change the model's revision and those pins change with it.
- **The MCP server is an ES module, which has no `__dirname`.** The shared modules find what ships
  beside them through it — the HTML scene runtime among them — so `vite.mcp.config.ts`
  defines `__dirname` and `__filename` in the bundle's banner. Without that, the built server threw
  a `ReferenceError` on the first lookup and nothing caught it, because the tests run the sources;
  `builtServer.test.ts` runs the built bundle from `/` once there is one.
- **esbuild is a build tool, not part of the app.** `htmlScene/resources.ts` builds the scene runtime
  on first use only in a checkout, and loads esbuild there and only there; a packaged build ships the
  runtime already built and has no esbuild to load.
- **Find the checkout with `checkoutRoot()`, never by counting `..` from `__dirname`.** The same
  file runs from `src/` under the tests, from `out/main` in the app and from `out/mcp` in the MCP
  server, so any fixed count is right for one and wrong for the rest. The export page and the HTML
  scene runtime fall back to building from the sources when `out/` has no copy, which is exactly
  `npm run dev` straight after a download. Counted from `out/main`, export looked two folders above
  the repository, and the error, thrown inside the asset server, ended the app as "Talkie could not
  start". The tests and e2e never saw it: one runs from `src/`, the other after a full build.
- **Renderer entries are declared explicitly** in `electron.vite.config.ts` — the editor window
  and the recording toolbar. A new window needs adding there or it will not ship.

## Architecture

- `src/main/` — Electron main. Owns all file I/O, child processes, and network calls to model
  and speech services. IPC channels are named `project:*`, `settings:*` or `menu:*`; a test
  enforces that and that every channel has both a handler and a caller.
- `src/preload/` — two bridges: `index.ts` for the editor window, `toolbar.ts` for the recording
  toolbar (five calls, nothing more).
- `src/renderer/` — React. Reaches main only through `window.api`.
- `src/composition/` — the composition. Shared by the preview and the export, so what is on screen
  is what renders. It takes its clock, holds, media and motion from `src/video/`.
- `src/video/` — Talkie's own renderer, which draws both the preview and the export. `index.ts` is the composition's side and
  `preview.tsx` the editor's, kept apart so the export bundle carries no player; `own/player.tsx`
  is the player, `own/clock.tsx`, `own/media.tsx` and `own/hold.ts` what both draw with. The scenes'
  names (`useFrame`, `Sequence`, `spring`, `interpolate` …) are the ones they were first written
  against, and each is held to how it behaved then. `videoBoundary.test.ts` keeps the third-party
  renderer Talkie used to depend on from coming back — it is the one file that names it.
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

The script can have the whole window ("Focus on the script"; Esc gives the video back) — under the
stage it showed a scene and a half. It saves as you type, follows the playhead unless you are
typing, and says under each scene whether the words fit the clip: estimated at
`WORDS_PER_SECOND` until there is a take, then measured off it (`narrationFit.ts`). Timings are
painted as chips under a transparent textarea, so the stored text is exactly what was typed.

Token colours go through `color-mix` in `tailwind.config.ts` so `ring-accent/35` and the like
work. With bare `var()` Tailwind silently emitted nothing for any colour with an opacity.

**Timings live in the words.** A line beginning `[12.3]` is spoken at that second of its clip,
and `narrationFromText` reads them back on the way in — in the IPC handlers and in MCP, so every
route stores them the same way. Before that, editing narration anywhere cleared `beats` and
silently turned a timed take into one flat block.

**What is typed stays as typed.** The store keeps words tidied (`[2]` as `[2.0]`), and the
editors once put that copy back into the box after every autosave — with the full stop each line
was given and its line breaks joined — so whoever was typing found full stops appearing under the
cursor and lines vanishing. Now the box keeps its own text and compares by meaning
(`sameNarration`); a line's full stop is added only where it is spoken (`spokenLine`), and a line
that runs on keeps its break. Both editors show and save the timings: the timeline's box once
showed the words without them and saved them back that way.

**Slow work says so.** Writing words and voicing a scene take seconds to a minute; a spinner the
size of an icon looked frozen. `Working` says what is happening with a count that keeps moving,
in the scene's status, the clip's narration box and on the buttons, and the words are locked while
new ones are being written for them.

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
- **Scenes can be pointed at.** Asking about one scene was what people most wanted and could not
  say. The panel offers the clip selected on the timeline and lists every scene; the picked ones
  go with every turn, described the way `talkie_timeline` numbers them (`describeScenes`).
- **A run can be stopped** (`stopProjectAgent`, an abort signal on the CLI). What it already
  changed stays, inside the one undo step.

Rewrites from the right-click menu (Rephrase, Proofread, …) take seconds, so the window is told
as they start and end (`menu:rewrite`, `RewriteStatus.tsx`): the field is held, a note says what
is happening, and the answer goes back into the selection as it was. It used to be typed into
whatever had focus when the answer arrived.

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

## Versions: one project, cut several ways

The full walkthrough, a two-minute one, one for sales — the same clips, each version leaving some
out (`src/main/project/versions.ts`, kept in `versions.json`, which undo snapshots with the
timeline). One version is being worked on; it is what the preview plays and what export writes,
and the export is named for it. No file means the full video, as every project made before this.

- **A version lists what it leaves out, not what it keeps**, so a clip added later is in every
  version until someone takes it out of one.
- **Left-out clips stay on the timeline, dimmed, where they can be put back.** Only what plays is
  cut: `playable()` removes them and closes the gaps, and the export renders exactly that.
- **The timeline and the player count different frames.** The player plays the shorter video;
  the timeline, the script and the inspector show every clip. `useEditPlayer` stands between them,
  mapping frames both ways (`toPlayFrame` / `toEditFrame`), so nothing that shows the timeline
  knows versions exist. The transport bar alone uses the player directly, since its length is the
  version's. A point inside a left-out clip goes to where the next played clip starts.
- **Agents get every verb**: `talkie_versions`, `talkie_include_clip`, `talkie_create_version`,
  `talkie_choose_version`, `talkie_rename_version`, `talkie_delete_version`, and
  `talkie_timeline` marks what the version leaves out.

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
  SVG logos; CSS animation runs on the clock and the export draws frames out of order, so
  `stillLogo.ts` settles every animation into its end state when the theme is drawn (the file stays
  as published). `LogoMark` reads the logo's colours in the browser and, on a slide or card whose
  background would hide too much of it, puts it on a plate in the theme's light or dark colour.
- **No theme means the old look, exactly** — the old palette names still render as they did.
- **AI themes**: `generate/` reads the site headless (one page, no clicks), the narration
  provider chooses (rules if not), fonts come only from Google Fonts' `ofl/`/`apache/`, contrast
  is fixed, and the result waits in `Themes/.drafts` until saved.
- **A company's own fonts** go in through the editor's Fonts section (first, above the colours)
  or "Company fonts" when creating with AI, which then replaces the open fonts it would pick. Each
  file is read for what it is — family, weight, italic, variable — from its own name and OS/2
  tables (`fontInfo.ts`: TTF/OTF as they are, WOFF via zlib, WOFF2 via Brotli; no font library),
  so the family names itself and every file is declared at its real weight and slant. The weight
  used to come from the file's name, which only Talkie's own downloads (`Inter-600`) carry: a
  company's `AcmeSans-Bold.otf` was declared as every weight and fought its regular for the text.
  A file that is not a readable font is refused as it is added.

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
- **Adding a scene in the app adds an HTML scene.** Its templates cover what Slide and Diagram did
  (`slide`, `quote`, `steps`, `timeline`, beside the charts and motion ones), so the dialog no longer
  offers those kinds; slides and diagrams already in a project still open in their own editors, and
  agents keep `talkie_add_scene` and `talkie_add_diagram`. Each template declares its values in a
  `talkie-values` JSON block (a scene made from it starts with them — without them its form said
  there was nothing to change) and its gallery group in `talkie:category`, and carries a
  `thumbnail.png` for the gallery, never copied into a scene. A new template needs all three, and
  `templates.test.ts` checks it in two themes with the values it declares.
- **The scene editor is a form first.** `ParamsForm` is shaped by the values at any depth — rows for
  a list, a card per thing in a list of things — and the preview plays the values and look as they
  are changed, restarting the page (it reads its values once) at the moment being looked at.

## Examples

Talkie ships ready-made projects (`examples/projects/<id>/`), copied among the person's own on
first launch by `installExamples.ts` — in milliseconds, nothing is made on their machine. Once
each, so a deleted one stays deleted; a new example, or a new `version` of one, arrives once, beside
any older copy rather than over it, since that copy may hold their changes.

They are ordinary projects, made by `npm run examples:rebuild` (`STORY=<id>` for one) through the
same functions the app uses, voiced in Kokoro, with every take checked for silence. Only someone
changing a story runs it; commit what it writes to `examples/projects/`, and raise the story's
`version` when people with the old one should get the new.

- **Clips store absolute paths**, so a shipped example holds `{{TALKIE_PROJECT_DIR}}` instead and
  the installer fills it in. Copying a project by hand left every clip pointing at the machine it
  came from, and export failed with a 404 for each.
- **Meet Talkie is filmed, not staged.** `examples/build/tour/` drives the built app in a throwaway
  home, records its windows, draws a pointer in (a recording has none), writes each click down for
  the zoom, and cuts out the waiting. A rebuild reuses the footage Meet Talkie already ships;
  `REFILM=1` films it again, about nine minutes with the app on screen — leave its windows alone,
  closing one ends the filming. The tour breaks when the app does, so treat a failed filming as a
  bug report. `TOUR=1 TOUR_UNTIL=<shot>` films part of it; `TOUR_REUSE=1` re-cuts the last
  filming. Build first, and not while `npm run dev` is running: both write `out/`, which it films.
- **The tour drafts and runs the agent through the Claude CLI**, which keeps its login in the
  keychain under the real home. A `claude` shim on PATH gives that one process HOME back; the
  agent's MCP server is told the tour's home (`TALKIE_HOME`) separately, so it never reaches the
  person's projects. Never point the build at the real `~/Talkie` — settings hold API keys.
- **The walkthrough is recorded through Talkie's own recorder** (`StoryProject.recording`), headed:
  headless Chromium draws a 1.5x page into only the top 720 rows of the frame and pads the rest
  grey. Each scene is marked as it starts and the recording is cut at the marks, not by the
  splitter, so every line is over the moment it was written for.
- **Taskboard** (`examples/apps/taskboard/`) is the demo app the examples record and the tour makes
  a theme from. It starts the same every time, so a rebuild films the same board.

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
  microphone, fullscreen, and writing to the clipboard (`clipboard-sanitized-write`, what every
  Copy button asks for — never `clipboard-read`). Anything added to that list upstream arrives refused. Written as a
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
- **Talkie draws and exports video with its own renderer.** It used to depend on a third-party
  renderer that is source-available rather than open source; that is gone, and
  `videoBoundary.test.ts` keeps it that way.
- **ffmpeg is GPL**: Talkie's own (FFmpeg 9.0.2, GPL-3.0-or-later, x264 and x265 linked in) is
  fetched by `npm install`. It is not in this repository.
- Publishing *source* carries no ffmpeg obligation. **Shipping a built `.dmg` does**, including
  offering ffmpeg's source to every recipient. That is why no prebuilt binaries are published
  here, and why the Mac App Store is not a route (App Sandbox also blocks `say`, `afconvert`,
  driving a browser, and the MCP server).
- **eSpeak NG, inside the Kokoro voice, is GPL-3.0**, and unlike ffmpeg it is in the repository,
  compiled, in `packages/phonemizer` — so passing on the source carries the obligation as well as
  shipping a build. Its source is the pinned commit plus `packages/phonemizer/build/`, which
  travel with it; NOTICE says so. The Kokoro weights are Apache-2.0 and are downloaded on
  first use, pinned and hash-checked, not shipped.
- **Licence texts no package carries live in `licences/`** — the GPL v2 and v3, the LGPL v2.1,
  and ONNX Runtime's MIT notice and ThirdPartyNotices — and are installed with the app.
- **Electron and Chromium are shipped, so their licences are too.** electron-builder leaves
  Electron's `LICENSE` and Chromium's `LICENSES.chromium.html` out of a macOS app, so
  `electron-builder.yml` copies them into `Resources/licences/electron/`. The Licences screen lists
  both, and the LGPL FFmpeg inside Chromium (`libffmpeg.dylib`) beside the GPL binaries. Replace the ONNX
  Runtime files when `onnxruntime-node` changes version; a test checks they match.
- See `NOTICE` and the in-app Settings → Licences screen, generated by `npm run notices`.

## Conventions

- **Comments say why, not what.** The codebase explains the reason a thing is the way it is,
  usually the failure that shaped it. Match that density and tone; do not narrate the code.
- **British spelling in user-facing text and in names** — colour, licence, sanitise.
- **Design tokens only**, from `src/renderer/src/styles/index.css` — the Studio look: depth from
  three surfaces (`bg`, `surface`, `raised`) rather than outlines, which are only for dividers
  inside a panel. The accent is one solid blue: `accent-fill` (`#2563eb`, white text) on what is
  acted on, `accent-soft` (a tint of it) on AI and voice actions, and `accent` for text and
  outlines (`#79a8ff` dark, `#1a4bb8` light), used as text at 10–11px. It replaced a violet→cyan
  gradient that read as decoration; leave the colour to the video. Floors: 5.8:1 for
  accent text, 4.5:1 for body and muted text, on every surface; `contrast.test.ts` holds both
  themes to them. Dark is the default; red is only for recording and the playhead.
- **The editor is a rail, one side panel, the stage, an inspector and the timeline.** The agent
  stays mounted while its panel is shut, so a conversation and a run in progress survive.
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
