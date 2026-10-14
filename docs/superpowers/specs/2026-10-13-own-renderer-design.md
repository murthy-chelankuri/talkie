# Talkie's own renderer — design

Date: 2026-10-13 · Branch: `feature/own-renderer` · Project 1 of 2 (project 2: Windows and Linux)

## Goal

Talkie draws and exports its videos with code it owns. Remotion — source-available, not open
source, and paid for larger companies — leaves the dependency tree entirely, for the preview as
well as the export. Nothing a person sees changes: the same scenes, the same motion, the same
progress and the same file, at no worse than 1.2× today's export time.

Nothing in this project may be specific to macOS. Project 2 takes Talkie to Windows and Linux and
starts from what this one leaves.

## Decisions (agreed in brainstorming)

| Question | Decision |
|---|---|
| Why | Remotion's licence. The repository is to be public; anyone using it, and every company above three people, would otherwise need their own Remotion eligibility. |
| Distribution | **Source only for now**; installers later. GPL tools are acceptable today, but no feature may *depend* on a GPL-only component, so an installer later is a substitution, not a rewrite. |
| Approach | **A — frame-by-frame screenshots from several headless tabs**, keeping the React composition. Not a canvas rewrite (HTML scenes would still need A — two renderers), not Revideo (every scene rewritten; another dependency we do not control). |
| Migration | **Step by step**, one PR each, Remotion kept as the reference until the last step. |
| ffmpeg | Pinned builds of ffmpeg and ffprobe (GPL-3.0, nothing nonfree) fetched and hash-checked by `scripts/fetchFfmpeg.mjs`, behind one module, with an encoder table per system. Not `ffmpeg-static`/`ffprobe-static`; see §2. |
| Platforms | Every new piece works on macOS, Windows and Linux; only project 2's encoder rows and packaging are left. |

## The five steps

| Step | PR | Done when |
|---|---|---|
| 1 | **The seam** — `src/video/`, every Remotion import goes through it, still delegating to Remotion | Nothing outside `src/video/` imports `remotion` or `@remotion/player`, and `@remotion/renderer`/`@remotion/bundler` only in `src/main/` and `scripts/` (steps 2–3 remove those); behaviour unchanged; all gates pass |
| 2 | **Our own ffmpeg** — `src/main/media/`, pinned, hash-checked ffmpeg and ffprobe builds replace the compositor's binaries | Nothing outside `src/main/media/` spawns ffmpeg; packaged build finds the binaries; all gates pass |
| 3 | **Our own export**, beside Remotion's (`TALKIE_RENDERER=remotion\|own`, default `own` once proven) | Comparison test and speed limit pass (§3) |
| 4 | **Our own preview player** | Existing player e2e unchanged and passing; new in-step e2e passes (§4) |
| 5 | **Remotion removed**, documentation and licensing rewritten | No `remotion` package installed; examples rebuilt and watched end to end |

Steps 1–3 are done: Talkie's own export is the default, with `TALKIE_RENDERER=remotion` the way back, and
`npm run compare:renderer` holds both shipped fixtures to §3's limits — the same frames and length, the
same picture at five moments a clip, the same loudness and silences, and no slower than 1.2× Remotion.
Getting the picture to match took serving recording frames as PNG, matching each to the frame Remotion
shows by time (the recording is 25 fps under a 30 fps composition and opens at a non-zero PTS), and
capturing screenshots at Remotion's own JPEG quality so a saturated edge rings the same way.

Every PR passes `npm test`, `npm run typecheck` and `npm run e2e`, as now.

## 1. `src/video/` — the frame clock and media

The only module the composition imports for time and media. In step 1 each piece is a thin
re-export of Remotion; steps 3 and 4 replace the insides, and the scenes are not touched again.

| Ours | Replaces | Behaviour |
|---|---|---|
| `<VideoRoot frame fps width height durationInFrames mode>` | `registerRoot`, `<Composition>` | Provides the clock. The host (export page or preview player) owns the frame. `mode: 'export' \| 'preview'`. |
| `useFrame()` | `useCurrentFrame` | Frame relative to the nearest `<Sequence>`. |
| `useVideoConfig()` | `useVideoConfig` | `{ fps, width, height, durationInFrames }` — of the enclosing `<Sequence>` for duration, as Remotion's is. |
| `useRenderMode()` | `getRemotionEnvironment().isRendering` | `'export' \| 'preview'`. |
| `<Sequence from durationInFrames?>` | `Sequence` | Offsets the clock for its children; mounts them only while the frame is inside it. Children sit in one full-frame column layer, as `Fill`. A nested Sequence ends no later than its parent. |
| `<Fill style>` | `AbsoluteFill` | A layer covering the whole frame as a flex column: absolute, top/left/right/bottom 0, width and height 100%, `display: flex`, `flex-direction: column`; the caller's `style` applies over it. Slides centre themselves on that column. |
| `hold(label, { timeoutMs? })` → `release()` | `delayRender` / `continueRender` | In export, a frame is captured only when no hold is open. A hold past its timeout fails the export with its label (§3). In preview, holds never block. |
| `<Picture src>` | `Img` | `<img>` holding until loaded and `decode()`d. |
| `<Footage src trimBefore trimAfter>` | `OffthreadVideo` | Export: an `<img>` of the exact frame from the asset server (§3). Preview: a `<video>` the player keeps in step (§4). |
| `<Sound src>` | `Audio` | Preview: an `<audio>` the player keeps in step. Export: renders nothing; the soundtrack is mixed from the timeline (§3). |
| `interpolate(value, input, output, options?)` | `interpolate` | Linear, with `extrapolateLeft/Right: 'clamp' \| 'extend'` (default `extend`, as Remotion). |
| `spring({ frame, fps, config, durationInFrames? })` | `spring` | Our own damped-harmonic-oscillator implementation (mass, stiffness, damping, overshoot clamping; `durationInFrames` rescales time to settle in that many frames). Written from the physics, not from Remotion's code. While both exist, a test compares ours with values sampled from Remotion's for the configs Talkie uses; the sampled numbers are kept as test data. |

During steps 3 and 4 Remotion's export and Talkie's run side by side from the same composition, so `src/video` picks its implementation per host (a context provided by `<VideoRoot>`, falling back to Remotion's), decided in step 3's plan; scenes do not change either way.

Scenes change only their imports and these names: `ThemeFonts`, `LogoMark`, `DiagramScene` and
`HtmlScene` move from `delayRender`/`continueRender` to `hold`/`release`.

**The export page** (replacing `src/remotion/index.tsx`) is a plain page: it reads
`{ timeline, theme }` passed to it, renders `<VideoRoot mode="export">`, and exposes
`window.talkie.ready(): Promise<void>` (fonts loaded, nothing held) and
`window.talkie.seek(frame): Promise<void>` (resolves once the frame is drawn and nothing is held).

**Guard:** `videoBoundary.test.ts`, in the manner of `kokoroBoundary.test.ts`, fails on any import
of `remotion` or `@remotion/*` outside `src/video/` (type-only imports included). Removed in step 5
in favour of the installed-tree check.

## 2. `src/main/media/` — ffmpeg

Today Remotion's compositor package supplies `ffmpeg` and `ffprobe`; `callFf` (22 uses) and
`getVideoMetadata` (15) reach them, located by `binaries.ts`.

- **Binaries:** pinned FFmpeg 9.0.2 builds from ffmpeg.martin-riedl.de for macOS and Linux (arm64, x64), fetched into `vendor/ffmpeg/<platform>-<arch>/` on install and packaged into `Resources/ffmpeg/`; Windows' row (BtbN's builds) is project 2's. `ffmpegPath()`/`ffprobePath()` find them from their own folder.
- **Calls:** `runFfmpeg(args, { onProgress?, signal? })` and `probeMedia(path)` →
  `{ durationSeconds, width, height, fps, hasAudio }` from ffprobe's JSON. The 37 call sites move
  over with their arguments unchanged.
- **Encoder table** (`encoders.ts`): an ordered list per platform; the first the installed ffmpeg
  offers (`ffmpeg -hide_banner -encoders`, asked once and remembered) wins. Each entry carries its
  own quality arguments; callers ask for `h264('export' | 'intermediate')`.
  - darwin: `h264_videotoolbox` — `-q:v` 65 for intermediates, as `stitchRecording.ts` uses
    today; for the export, the `-q:v` that brings the four comparison fixtures (§3) within 10% of
    Remotion's file size, chosen and recorded in step 3
  - win32 and linux: rows filled in by project 2. This project only makes the table able to hold
    them.
- **`gplEncoders.test.ts`** keeps holding macOS to no x264/x265; project 2 decides Linux's last
  resort.
- **Guard:** a test fails if anything outside `src/main/media/` spawns `ffmpeg`/`ffprobe` or
  imports a binary package. `packagedBinaries.test.ts` is updated to the new paths.
- **Install failures:** `scripts/fetchFfmpeg.mjs` runs on install and warns if it cannot fetch; `npm run dev` runs it with `--ensure`, which fails naming the same three causes as `ensureElectron.mjs`.

**First task of step 2 — a check, not an assumption:** install both packages and confirm, on this
Mac, `ffmpeg -encoders` lists `h264_videotoolbox` and `ffmpeg -filters` lists `loudnorm`,
`concat`, `amix`, `adelay`, `apad`. If not, fall back to a pinned ffmpeg build fetched and
hash-checked by our own script, as the Kokoro model is. The plan records which. Done while planning step 2: `ffmpeg-static` has the encoders and filters, but its macOS build is `--enable-nonfree` and calls itself not legally redistributable, and `ffprobe-static`'s Apple Silicon binary does not run — so the fallback was taken.

## 3. Export

`renderProject.ts` keeps its signature, its progress stages (`preparing → rendering → encoding →
finishing`), its `cancelSignal`, output path, loudness levelling and captions. The middle becomes
`src/main/render/exporter/`.

**Preparing.** One headless-shell browser (`browserExecutablePath()`, as now), N tabs, N =
`min(6, max(1, floor(cpus / 2)))`. Each tab loads the export page from the asset server — so the
per-run secret and the `frame-src` policy apply as now — receives the timeline and theme, and
awaits `ready()`.

**Rendering.** Frames `[0, total)` are split into N consecutive ranges. For each frame a tab
calls `seek(frame)`, captures the viewport over CDP (`Page.captureScreenshot`, JPEG quality 92,
1920×1080 at device scale 1), and writes it to its own ffmpeg (`image2pipe` →
`h264('export')`, 30 fps, `yuv420p`, `bt709` tags, keyframe at its first frame) producing one
segment. Progress is the sum of frames captured across tabs.

**Footage.** `<Footage>` in export mode requests `/frame/<n>` from the asset server, naming its `src` and `trimBefore`
(which `Footage` already has, so `VideoItem` does not change). Per clip per tab, keyed on those two, the server keeps one ffmpeg decoding forward from the requested frame (`-ss`
to the clip's `trimBefore` + n) and hands frames out in order; a request behind the decoder or
more than two seconds ahead restarts it there. Frames are JPEG. Click zoom is unchanged — it is
CSS on the frame, as now.

**Encoding.**
- Segments are joined with the `concat` demuxer, no re-encode.
- The soundtrack comes from the timeline, not the page: each take is placed at its clip's
  start plus the narration lead-in (`adelay`), mixed (`amix`, `normalize=0`), padded to the
  video's length (`apad` + `-t`), and encoded AAC 48 kHz; recordings stay silent. Each take is
  also trimmed (`atrim`) to end at its clip's end, as the composition cuts it today, since a
  nested Sequence ends with its parent. The lead-in
  becomes one shared function, used by export, preview and captions.
- Video and soundtrack are muxed into the MP4 (`-c copy`, `+faststart`).

**Finishing.** `levelExport` and `writeCaptionsBeside`, unchanged.

**Failure.**
- A hold past its timeout — 30 s for loading, the existing 5 s per frame for HTML scenes —
  fails the export with its label, frame and clip, logged as now. A stuck HTML frame keeps
  today's behaviour: drawn as it is, export continues (`htmlSceneExport.test.ts`).
- A crashed tab or an ffmpeg that exits non-zero fails the export and stops the rest.
- Cancelling — including quit mid-export (`exportJob.ts`) — closes the browser and kills every
  ffmpeg it started.
- Segments and the soundtrack live in `renders/.parts-<export-id>/`, removed in a `finally`.

**Proof (steps 3–4 only).** `TALKIE_RENDERER=remotion|own` chooses the exporter. A comparison
test exports four fixture projects — a slide, a diagram, an HTML scene, a recording with clicks —
both ways, and requires:
- identical frame counts and durations;
- frames sampled at 5 points per clip within a mean absolute per-channel difference of 3/255
  and no pixel beyond 48/255 outside a 2-pixel margin of text edges;
- soundtrack integrated loudness within 0.5 LU, and silences in the same places within 2 frames;
- the 55-second demo exported by `own` in at most 1.2× the time `remotion` takes on the same
  machine, measured in the same run.

## 4. Preview

The editor drives Remotion's `<Player>` in three places — the stage (`Editor.tsx`), the HTML scene
panel and the theme preview — through `seekTo`, `getCurrentFrame`, `toggle`, `isPlaying`,
`mute`/`unmute`/`isMuted`, `requestFullscreen`, and the events `frameupdate`, `play`, `pause`.
`<Preview>` in `src/video/` offers **that handle and those events, unchanged**, so `TransportBar`,
`Timeline`, `ScriptView` and the three hosts change only their imports.

- **Clock:** while playing, each animation frame computes the frame from elapsed time — the
  audio element's clock when one is playing, `performance.now()` otherwise — renders the
  composition at it and fires `frameupdate`. A slow machine skips frames rather than falls behind.
- **Media:** `<Footage>` is a `<video>`, `<Sound>` an `<audio>`, started at the position their
  clip implies, honouring `trimBefore`/`trimAfter`. Each frame the player re-seeks any element
  more than one frame from the clock.
- **Preloading:** the next clip's media mounts, hidden, 0.5 s before its clip starts.
- **Seeking and scrubbing** pause media, set the frame, and seek every mounted element; the picture
  follows at once, media catches up when ready.
- **Scale:** the composition is drawn at `width`×`height` and scaled to fit the element, as the Player does; scenes use fixed pixel sizes and depend on it.
- **HTML scenes** are told the frame as now; preview never waits on holds.
- **Mute and fullscreen** act on the player's container, so `permissions.ts`'s fullscreen rule
  still applies.

**Proof.** Unit tests for the clock (play, pause, seek, end, a stalled frame). The existing e2e
for playing a project, an HTML scene and the transport pass unchanged. A new e2e plays across a
cut from a recording to a narrated slide and requires `<video>` and `<audio>` within two frames of
the clock.

`controls`, `loop` and `autoPlay` are kept: the HTML scene panel and the theme preview use the player's own controls and loop, and the theme preview starts by itself. Not included: playback speed — Talkie does not use it.

## 5. Removal and documentation

- **Export page build:** a Vite entry outputs `out/video/` (as `out/html-scene/` is built),
  served by the asset server and in `asarUnpack`. Deleted: `scripts/bundleRemotion.mjs`,
  `remotionBundle.ts`, the `build:remotion` script and its `asarUnpack` entry.
- **Deleted:** `TALKIE_RENDERER`, the comparison test, `videoBoundary.test.ts`.
- **Dependencies removed:** `remotion`, `@remotion/player`, `@remotion/renderer`,
  `@remotion/bundler`, the compositor packages. `licences.test.ts` fails if any `remotion`
  package is in the installed tree.
- **README / NOTICE:** the Remotion section goes; the ffmpeg section describes the pinned builds (`scripts/ffmpegBuilds.json`)
  (GPL, not in the repository, fetched by npm; source-only vs installer table unchanged) and
  states what installers would need — an LGPL ffmpeg with the system encoders, and an answer for
  eSpeak NG in Kokoro.
- **AGENTS.md:** the Remotion entries under "Things that will bite you" are rewritten for the
  renderer — the export page bundle, `browserExecutablePath` and the headless shell, exporting
  from `/`, binaries outside the archive — each keeping its test (`exportFromAnywhere`,
  `packagedBinaries`, `runtimeCompatibility`). New: `src/video/` and `src/main/media/` as the only
  ways in, and why holds time out.
- **`npm run notices`** regenerated.
- **Last check:** all four examples rebuilt and exported with the new renderer and watched end
  to end before step 5 merges.

**Rollback:** until step 5, `TALKIE_RENDERER=remotion` restores the old export and the preview
switch is a one-PR revert. After step 5, a revert.

## Project 2 — Windows and Linux (outline only; its own design follows)

Found in the survey for this design:
- **Voice:** `say` and `afconvert` are macOS only (`sayTtsProvider.ts`, `listVoices.ts`,
  `voicePauseSupport.ts`); Kokoro becomes the voice elsewhere. ONNX Runtime ships Windows and
  Linux builds, currently excluded in `electron-builder.yml`.
- **Platform branches:** microphone permission (`microphone.ts`), menus (`applicationMenu.ts`,
  `editContextMenu.ts`), readiness checks (`readiness.ts`), `index.ts`.
- **Encoders:** the win32 and linux rows of the table (Media Foundation / QSV / NVENC; VA-API,
  OpenH264, and libx264 as a source-build last resort).
- **Elsewhere to check:** the claude/copilot CLI discovery and keychain assumptions, MCP config
  paths, Kokoro model cache paths, packaging targets and icons, and CI on all three systems.

## Not in this project

Installers and their licensing; GPU-accelerated capture; WebCodecs encoding in the page; playback
speed and looping; any change to what scenes look like.
