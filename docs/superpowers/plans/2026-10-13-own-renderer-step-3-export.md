# Own renderer, step 3 — our own export: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Talkie exports its videos with its own exporter, frame by frame from several headless tabs into its own ffmpeg. It becomes the default, with Remotion's export kept beside it (`TALKIE_RENDERER=remotion`) until a comparison test shows the two agree.

**Architecture:**
- **The seam gets an engine of its own.** `src/video/` gains its own engine: a clock (`VideoRoot`, contexts for the frame and the enclosing Sequence's span), a hold registry, and media.
  - In the export page, `chooseOwnRenderer()` switches every seam primitive to it.
  - Everywhere else, the Remotion bundle and the editor's player, the seam still delegates to Remotion. Nothing in the scenes changes.
- **The export page** is a small esbuild bundle served by the asset server. It renders `DemoComposition` inside `<VideoRoot mode="export">` and offers `window.talkie.load/seek`.
- **The exporter**, `src/main/render/exporter/`, works in four stages:
  - It opens N tabs in the headless shell, seeks each through its own range of frames, and captures JPEGs over CDP into one ffmpeg segment per tab.
  - It joins the segments with the concat demuxer.
  - It mixes the soundtrack from the timeline.
  - It muxes the video and the soundtrack together.
- **Recordings** are drawn from frames the asset server decodes with ffmpeg, `?frame=<n>&reader=<r>` on the video's own URL.

**Tech Stack:**
- React 18
- Playwright's Chromium headless shell, over the Chrome DevTools Protocol (CDP)
- esbuild
- the pinned FFmpeg 9.0.2 via `src/main/media` (step 2)
- vitest 2

**Spec:** `docs/superpowers/specs/2026-10-13-own-renderer-design.md` §1 (the table, and the sentence on choosing the implementation per host), §3 entire.

## Global Constraints

**Where to work**
- Work in `/Users/murthy/Documents/Github/talkie-renderer` on branch `feature/own-renderer-export`, cut from `feature/own-renderer-ffmpeg` (PR #27, stacked on #26).
- `node_modules` is an untracked symlink to `../talkie/node_modules`.
  - Never run `npm install` or `npm ci`. Never run `git add -A` or `git add .`.
  - Never commit `vendor/`, `out/` or `release/`.
  - To add a package, stop and report it. Nothing in this plan needs one.

**What must not change**
- The video someone gets: same scenes, same motion, same length, a soundtrack, levelled, captions beside it.
- Progress: preparing → rendering → encoding → finishing.
- Cancel and quit-while-exporting still stop everything.
- Every PR passes `npm test`, `npm run typecheck` and `npm run e2e`.

**What else must hold**
- Nothing specific to macOS in new code; encoder rows stay in `src/main/media/encoders.ts`.
- Only `src/main/media` runs ffmpeg (`mediaBoundary.test.ts`). Only `src/video` and `src/main/render` (+ `scripts`) touch Remotion (`videoBoundary.test.ts`).

**Conventions**
- Use British spelling. Comments say *why*. Tests describe behaviour.
- A test that drives a browser or ffmpeg gets at least 60 s.
- Every commit message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never use `--no-verify`, never read `~/Talkie/settings.json`, and never push.

## Decisions this plan makes

- **One engine per page, chosen once.** The Remotion bundle and the export page are separate bundles with separate module instances, so a module-level switch (`chooseOwnRenderer()`) is enough, and hooks stay in a stable order. This is the spec §1 sentence ("picks its implementation per host"), made concrete.
- **Holds:**
  - Each hold carries a default timeout of 30 s, as Remotion's `delayRender` does.
  - A hold past its timeout fails the export, naming its label and the frame.
  - A picture that fails to load fails the export at once, as Remotion's `Img` does. Remotion retries twice first; Talkie's asset server is local, so it does not.
- **Recording frames are fetched by the footage's own URL** with `?frame=<n>&reader=<r>`, keyed on the file and the reader. This follows the spec §3 ruling from step 1: no clip id is needed, and `VideoItem` stays unchanged.
  - `n` counts composition frames from the file's start, so time = `n / 30` s.
  - Past `trimAfter`, nothing is drawn. Remotion's `OffthreadVideo` wraps itself in a Sequence of length `trimAfter`.
  - Past the end of the file, the last frame is drawn.
- **The export page is built with esbuild**, as `out/html-scene/` is, into `out/export-page/`. In a checkout it is built on first use. The spec said "a Vite entry"; esbuild is what the repository already uses for exactly this. The spec's §5 deletion list is unaffected.
- **Colour and capture:**
  - JPEG frames go through `scale=out_color_matrix=bt709:out_range=tv,format=yuv420p` and carry `bt709` tags. Without the matrix, ffmpeg converts with BT.601 and every colour shifts.
  - Capture is at JPEG quality 92. Remotion's default is 80.
- **The soundtrack matches Remotion's mix:**
  - Each take starts at its clip's start + `NARRATION_LEAD_IN_FRAMES` and stops at its clip's end.
  - Takes are summed (`normalize=0`), as stereo 48 kHz AAC.
  - A project with no takes still gets a silent track, as Remotion's export always had one.
- **The renderer is chosen by option or environment.** `RenderOptions.renderer ?? process.env.TALKIE_RENDERER ?? 'own'`. The comparison test passes the option and never depends on the environment.
- **Cancelling** becomes an `AbortSignal` throughout (`RenderOptions.signal`). The Remotion path adapts it to `makeCancelSignal` inside `remotionExport.ts`.
- **Tab count** is `min(6, max(1, floor(cpus / 2)))`, as the spec says. That is 5 on this 10-core Mac.
- **The comparison suite is opt-in and slow:** `npm run compare:renderer`, with its own vitest config. It runs in Task 7's gates, not in `npm test`.
  - Its fixtures are the shipped examples. `app-walkthrough` (57 s, slides and a recording with clicks) is also the speed fixture. `architecture-explainer` (72 s) brings slides, diagrams and an HTML scene.

---

### Task 1: The seam's own engine

**Files:**
- Create:
  - `src/video/engine.ts`
  - `src/video/own/clock.tsx`, `src/video/own/hold.ts`, `src/video/own/media.tsx`
  - `src/video/own/clock.test.tsx`, `src/video/own/hold.test.ts`, `src/video/own/media.test.tsx`
- Modify: `src/video/clock.tsx`, `src/video/hold.ts`, `src/video/media.tsx`, `src/video/index.ts`

**Interfaces:**
- From `src/video/engine.ts`:
  - `chooseOwnRenderer(): void`
  - `isOwnRenderer(): boolean`
- From `src/video/own/clock.tsx`:
  - `VideoRoot(props: { frame: number; fps: number; width: number; height: number; durationInFrames: number; mode: RenderMode; children: ReactNode })`
  - `useOwnFrame()`, `useOwnVideoConfig()`, `useOwnRenderMode()`
  - `OwnSequence`, `OwnFill`
  - `FILL_STYLE: CSSProperties`
- From `src/video/own/hold.ts`:
  - `ownHold(label: string, timeoutMs?: number): Release`
  - `reportFailure(message: string): void`
  - `whenSettled(options?: { now?: () => number; wait?: () => Promise<void> }): Promise<void>`, which rejects with the first failure or overdue hold
  - `openHoldCount(): number`, and `resetHolds(): void`, for tests
  - `ownHold` also takes an optional third argument `now: () => number`, which tests pass to control time
- From `src/video/own/media.tsx`:
  - `OwnPicture`, `OwnFootage`, `OwnSound`
  - `setFrameReader(reader: string): void`
  - `footageFrameUrl(src: string, sourceFrame: number, reader: string): string`
- From `src/video/index.ts`, everything as before, plus `VideoRoot`, `chooseOwnRenderer` and `whenSettled`.

- [ ] **Step 1: Write the failing tests**

`src/video/own/clock.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OwnFill, OwnSequence, VideoRoot, useOwnFrame, useOwnVideoConfig } from './clock'

/**
 * Talkie's own clock, held to how Remotion's behaved — the rules every scene was drawn against
 * (see the docblocks in ../clock.tsx). These run without a browser: the frame is a prop.
 */
function Show(): JSX.Element {
  const frame = useOwnFrame()
  const { durationInFrames } = useOwnVideoConfig()
  return <i>{`${frame}/${durationInFrames}`}</i>
}

const at = (frame: number, children: JSX.Element): string =>
  renderToStaticMarkup(
    <VideoRoot frame={frame} fps={30} width={1920} height={1080} durationInFrames={300} mode="export">
      {children}
    </VideoRoot>
  )

describe('Talkie’s own clock', () => {
  it('counts frames from the start of the enclosing Sequence, and reports its length', () => {
    expect(at(40, <OwnSequence from={30} durationInFrames={60}><Show /></OwnSequence>)).toContain('<i>10/60</i>')
  })

  it('mounts a Sequence only while the frame is inside it', () => {
    expect(at(29, <OwnSequence from={30} durationInFrames={60}><Show /></OwnSequence>)).not.toContain('<i>')
    expect(at(90, <OwnSequence from={30} durationInFrames={60}><Show /></OwnSequence>)).not.toContain('<i>')
  })

  it('ends a nested Sequence with its parent, so a long take is cut at its clip’s end', () => {
    const nested = (
      <OwnSequence from={30} durationInFrames={60}>
        <OwnSequence from={18}><Show /></OwnSequence>
      </OwnSequence>
    )
    expect(at(50, nested)).toContain('<i>2/42</i>')
    expect(at(90, nested)).not.toContain('<i>')
  })

  it('reports the whole video’s length outside any Sequence', () => {
    expect(at(5, <Show />)).toContain('<i>5/300</i>')
  })

  it('lays a Sequence’s children out in one full-frame column, as a Fill', () => {
    const markup = at(40, <OwnSequence from={30}><b /></OwnSequence>)
    for (const rule of ['position:absolute', 'top:0', 'left:0', 'right:0', 'bottom:0', 'width:100%', 'height:100%', 'display:flex', 'flex-direction:column']) {
      expect(markup).toContain(rule)
    }
  })

  it('applies a Fill’s own style over its layout', () => {
    expect(at(0, <OwnFill style={{ background: 'red', justifyContent: 'center' }} />)).toMatch(/display:flex;flex-direction:column;background:red;justify-content:center/)
  })
})
```

`src/video/own/hold.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { ownHold, reportFailure, resetHolds, whenSettled } from './hold'

afterEach(() => resetHolds())

describe('Talkie’s own holds', () => {
  it('settles at once when nothing is held', async () => {
    await expect(whenSettled()).resolves.toBeUndefined()
  })

  it('waits until every hold is released', async () => {
    const release = ownHold('Loading the theme’s fonts')
    let settled = false
    const waiting = whenSettled({ wait: () => new Promise((resolve) => setTimeout(resolve, 1)) }).then(() => (settled = true))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).toBe(false)
    release()
    await waiting
    expect(settled).toBe(true)
  })

  it('lets go once, however many times it is released', async () => {
    const release = ownHold('Reading the logo’s colours')
    release()
    release()
    await expect(whenSettled()).resolves.toBeUndefined()
  })

  it('fails naming the hold that outlived its timeout', async () => {
    let clock = 0
    ownHold('Fetching diagram flow.svg', 1000, () => clock)
    const wait = async (): Promise<void> => void (clock += 600)
    await expect(whenSettled({ now: () => clock, wait })).rejects.toThrow('Fetching diagram flow.svg did not finish within 1 s')
  })

  it('gives up after 30 s when no timeout was given, as Remotion did', async () => {
    let clock = 0
    ownHold('Loading the HTML scene "Revenue"', undefined, () => clock)
    const wait = async (): Promise<void> => void (clock += 10_000)
    await expect(whenSettled({ now: () => clock, wait })).rejects.toThrow('within 30 s')
  })

  it('fails at once on a reported failure, so a broken picture does not wait out a timeout', async () => {
    ownHold('Loading clip.mp4')
    reportFailure('Could not load clip.mp4')
    await expect(whenSettled()).rejects.toThrow('Could not load clip.mp4')
  })
})
```

`src/video/own/media.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import { VideoRoot } from './clock'
import { openHoldCount, resetHolds } from './hold'
import { OwnFootage, OwnPicture, OwnSound, footageFrameUrl } from './media'

afterEach(() => resetHolds())

const root = (frame: number, children: JSX.Element): JSX.Element => (
  <VideoRoot frame={frame} fps={30} width={1920} height={1080} durationInFrames={300} mode="export">
    {children}
  </VideoRoot>
)

describe('Talkie’s own media', () => {
  it('holds the frame until a picture has loaded', async () => {
    const view = render(root(0, <OwnPicture src="http://127.0.0.1:1/s/p/a.png" />))
    expect(openHoldCount()).toBe(1)
    const img = view.container.querySelector('img')!
    // jsdom loads nothing; this stands in for the browser saying it has.
    Object.defineProperty(img, 'decode', { value: () => Promise.resolve() })
    await act(async () => void img.dispatchEvent(new Event('load')))
    expect(openHoldCount()).toBe(0)
  })

  it('asks the asset server for the recording’s frame at the clip’s moment', () => {
    const view = render(root(10, <OwnFootage src="http://127.0.0.1:1/s/p/rec.mp4" trimBefore={45} />))
    expect(view.container.querySelector('img')!.getAttribute('src')).toBe(footageFrameUrl('http://127.0.0.1:1/s/p/rec.mp4', 55, ''))
  })

  it('draws nothing past trimAfter, where the next scene of the same recording begins', () => {
    const view = render(root(20, <OwnFootage src="http://127.0.0.1:1/s/p/rec.mp4" trimBefore={45} trimAfter={60} />))
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('names the frame and the reader in the URL, keeping any query the URL had', () => {
    expect(footageFrameUrl('http://h/s/rec.mp4', 7, 'ab12-3')).toBe('http://h/s/rec.mp4?frame=7&reader=ab12-3')
    expect(footageFrameUrl('http://h/s/rec.mp4?v=2', 7, 'r')).toBe('http://h/s/rec.mp4?v=2&frame=7&reader=r')
  })

  it('plays no sound in the picture: the export mixes the soundtrack from the timeline', () => {
    expect(render(root(0, <OwnSound src="http://h/a.wav" />)).container.innerHTML).toBe('')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/video/own`

Expected: FAIL. The modules cannot be resolved.

- [ ] **Step 3: Write `src/video/engine.ts`**

```ts
/**
 * Which renderer draws this page: Remotion, as the editor's player and Remotion's export bundle
 * still do, or Talkie's own, as the export page does. Chosen once, by the page, before anything
 * renders — the two run as separate bundles, so a module-level choice is per page, and every
 * hook that consults it is called in the same order on every render.
 */
let own = false

export function chooseOwnRenderer(): void {
  own = true
}

export function isOwnRenderer(): boolean {
  return own
}
```

- [ ] **Step 4: Write `src/video/own/clock.tsx`**

```tsx
import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react'
import type { RenderMode, VideoConfig } from '../clock'

/**
 * Talkie's own frame clock. The host — the export page now, the editor's player in step 4 —
 * owns the frame and passes it in; scenes read it through the seam's hooks.
 */
type Clock = { frame: number; fps: number; width: number; height: number; durationInFrames: number; mode: RenderMode }
/** The enclosing Sequence, in absolute frames: where it starts and where it stops. */
type Span = { start: number; end: number }

const ClockContext = createContext<Clock | null>(null)
const SpanContext = createContext<Span>({ start: 0, end: Infinity })

/** The layout Remotion's AbsoluteFill had, which every scene was drawn against. */
export const FILL_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column'
}

export function VideoRoot({
  frame,
  fps,
  width,
  height,
  durationInFrames,
  mode,
  children
}: Clock & { children: ReactNode }): JSX.Element {
  const clock = useMemo(() => ({ frame, fps, width, height, durationInFrames, mode }), [frame, fps, width, height, durationInFrames, mode])
  const span = useMemo(() => ({ start: 0, end: durationInFrames }), [durationInFrames])
  return (
    <ClockContext.Provider value={clock}>
      <SpanContext.Provider value={span}>{children}</SpanContext.Provider>
    </ClockContext.Provider>
  )
}

function useClock(): Clock {
  const clock = useContext(ClockContext)
  if (!clock) throw new Error('Talkie’s clock is only available inside <VideoRoot>.')
  return clock
}

export function useOwnFrame(): number {
  return useClock().frame - useContext(SpanContext).start
}

export function useOwnVideoConfig(): VideoConfig {
  const { fps, width, height } = useClock()
  const { start, end } = useContext(SpanContext)
  return { fps, width, height, durationInFrames: end - start }
}

export function useOwnRenderMode(): RenderMode {
  return useClock().mode
}

export function OwnSequence({ from, durationInFrames = Infinity, children }: { from: number; durationInFrames?: number; children: ReactNode }): JSX.Element | null {
  const { frame } = useClock()
  const parent = useContext(SpanContext)
  const start = parent.start + from
  // Never past the parent's end: a take longer than its clip is cut where the clip ends.
  const end = Math.min(parent.end, start + durationInFrames)
  const span = useMemo(() => ({ start, end }), [start, end])
  if (frame < start || frame >= end) return null
  return (
    <SpanContext.Provider value={span}>
      <div style={FILL_STYLE}>{children}</div>
    </SpanContext.Provider>
  )
}

export function OwnFill({ style, children }: { style?: CSSProperties; children?: ReactNode }): JSX.Element {
  return <div style={{ ...FILL_STYLE, ...style }}>{children}</div>
}
```

- [ ] **Step 5: Write `src/video/own/hold.ts`**

```ts
import type { Release } from '../hold'

/** Remotion's delayRender gave up after 30 s; so does this, so a stuck asset fails rather than hangs. */
const DEFAULT_TIMEOUT_MS = 30_000

type Open = { label: string; opened: number; timeoutMs: number }

const open = new Map<number, Open>()
let next = 1
let failure: string | null = null

export function ownHold(label: string, timeoutMs: number = DEFAULT_TIMEOUT_MS, now: () => number = Date.now): Release {
  const id = next++
  open.set(id, { label, opened: now(), timeoutMs })
  let released = false
  return () => {
    if (released) return
    released = true
    open.delete(id)
  }
}

/** Something a frame needs will never arrive. The next wait fails with this, at once. */
export function reportFailure(message: string): void {
  failure ??= message
}

export function openHoldCount(): number {
  return open.size
}

/**
 * Resolves once nothing is held. Rejects with a reported failure, or naming the first hold that
 * has outlived its timeout — the export fails with that label rather than waiting for ever.
 */
export async function whenSettled({
  now = Date.now,
  wait = () => new Promise<void>((resolve) => setTimeout(resolve, 4))
}: { now?: () => number; wait?: () => Promise<void> } = {}): Promise<void> {
  for (;;) {
    if (failure) throw new Error(failure)
    if (open.size === 0) return
    const overdue = [...open.values()].find((hold) => now() - hold.opened > hold.timeoutMs)
    if (overdue) throw new Error(`${overdue.label} did not finish within ${Math.round(overdue.timeoutMs / 1000)} s`)
    await wait()
  }
}

export function resetHolds(): void {
  open.clear()
  failure = null
}
```

- [ ] **Step 6: Write `src/video/own/media.tsx`**

```tsx
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useOwnFrame } from './clock'
import { ownHold, reportFailure } from './hold'

let frameReader = ''

/** Which tab this page is, so the asset server keeps one decoder per tab per recording. */
export function setFrameReader(reader: string): void {
  frameReader = reader
}

export function footageFrameUrl(src: string, sourceFrame: number, reader: string): string {
  return `${src}${src.includes('?') ? '&' : '?'}frame=${sourceFrame}&reader=${encodeURIComponent(reader)}`
}

/** A file's own name, for a label — never the URL, which carries the asset server's secret. */
function nameOf(src: string): string {
  try {
    return decodeURIComponent(new URL(src).pathname.split('/').pop() ?? src)
  } catch {
    return src
  }
}

/** An image, holding the frame until it has loaded and decoded, and failing the export if it cannot. */
export function OwnPicture({ src, alt, style, label }: { src: string; alt?: string; style?: CSSProperties; label?: string }): JSX.Element {
  const ref = useRef<HTMLImageElement>(null)
  const name = label ?? nameOf(src)
  const [release] = useState(() => ownHold(`Loading ${name}`))

  useEffect(() => {
    const img = ref.current
    if (!img) return
    let finished = false
    const loaded = (): void => {
      if (finished) return
      finished = true
      // Loaded is not drawn: decode() is what makes the next paint show it.
      void Promise.resolve(img.decode?.())
        .catch(() => undefined)
        .finally(release)
    }
    const failed = (): void => {
      reportFailure(`Could not load ${name}`)
      release()
    }
    if (img.complete && img.naturalWidth > 0) loaded()
    img.addEventListener('load', loaded)
    img.addEventListener('error', failed)
    return () => {
      img.removeEventListener('load', loaded)
      img.removeEventListener('error', failed)
      release()
    }
  }, [release, name])

  return <img ref={ref} src={src} alt={alt} style={style} />
}

/**
 * A recording's frame, decoded by the asset server with Talkie's ffmpeg. An <img> of the exact
 * frame rather than a <video> seeked to it: seeking a video frame by frame is what hung on
 * Playwright's VP8 files, and the headless shell cannot decode H.264 at all.
 */
export function OwnFootage({ src, trimBefore, trimAfter, style }: { src: string; trimBefore?: number; trimAfter?: number; style?: CSSProperties }): JSX.Element | null {
  const sourceFrame = (trimBefore ?? 0) + useOwnFrame()
  // Remotion's OffthreadVideo wrapped itself in a Sequence of length trimAfter: nothing after it.
  if (trimAfter !== undefined && sourceFrame >= trimAfter) return null
  const url = footageFrameUrl(src, sourceFrame, frameReader)
  return <OwnPicture key={url} src={url} style={style} label={`${nameOf(src)}, frame ${sourceFrame}`} />
}

/** Nothing in the picture: the export mixes the soundtrack from the timeline (soundtrack.ts). */
export function OwnSound(_props: { src: string }): null {
  return null
}
```

In `media.test.tsx`, the footage URL test expects reader `''`, because `setFrameReader` is never called there. That is consistent with this code.

- [ ] **Step 7: Route the seam to the engine**

In `src/video/clock.tsx`, import `isOwnRenderer` from `./engine` and `{ OwnFill, OwnSequence, useOwnFrame, useOwnRenderMode, useOwnVideoConfig }` from `./own/clock`. Then make each public function choose:

```tsx
export function useFrame(): number {
  // One engine per page (engine.ts), so the same hook is called on every render.
  return isOwnRenderer() ? useOwnFrame() : useCurrentFrame()
}
```

Do the same for the others:
- `useVideoConfig`: return `useOwnVideoConfig()` when `isOwnRenderer()`.
- `useRenderMode`: return `useOwnRenderMode()` when `isOwnRenderer()`.
- `Sequence`: render `<OwnSequence from durationInFrames>` when `isOwnRenderer()`.
- `Fill`: render `<OwnFill style>` when `isOwnRenderer()`.

In each docblock, change "Delegates to Remotion until…" to "Remotion's, or Talkie's own in the export page (engine.ts)".

In `src/video/hold.ts`, change the body so it starts:

```ts
  if (isOwnRenderer()) return ownHold(label, timeoutMs)
```

The Remotion code follows unchanged.

In `src/video/media.tsx`:
- `Picture` returns `<OwnPicture src alt style />`.
- `Footage` returns `<OwnFootage … />`.
- `Sound` returns `null` via `OwnSound`.

Each happens when `isOwnRenderer()` is true; otherwise the code is as now.

In `src/video/index.ts`, add:

```ts
export { chooseOwnRenderer } from './engine'
export { VideoRoot } from './own/clock'
export { whenSettled } from './own/hold'
export { setFrameReader } from './own/media'
```

- [ ] **Step 8: Run the tests, the seam's existing ones, and the types**

Run: `npx vitest run src/video src/remotion && npm run typecheck`

Expected: everything passes, including step 1's `clock.test.tsx` and `videoBoundary.test.ts`. The new tests are 6 + 6 + 5 = 17.

- [ ] **Step 9: Commit**

```bash
git add src/video/engine.ts src/video/own src/video/clock.tsx src/video/hold.ts src/video/media.tsx src/video/index.ts
git commit -m "$(cat <<'EOF'
Give src/video a clock, holds and media of its own, chosen per page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Recording frames from the asset server

**Files:**
- Modify: `src/main/media/run.ts` (add `spawnFfmpeg`), `src/main/media/index.ts`, `src/main/media/run.test.ts`, `src/main/render/assetServer.ts`
- Create: `src/main/render/exporter/frameSource.ts`, `src/main/render/exporter/frameSource.test.ts`

**Interfaces:**
- Consumes: `toolPath` and `probeMedia` (step 2), and `FPS` from `src/remotion/constants`.
- Produces:
  - `spawnFfmpeg(args: string[], options?: { signal?: AbortSignal }): RunningTool`
  - `type RunningTool = { process: ChildProcessWithoutNullStreams; done: Promise<void> }`
  - From `frameSource.ts`:
    - `footageFrame(reader: string, file: string, frame: number): Promise<Buffer>`, which returns a JPEG
    - `closeReaders(prefix: string): void`
    - `decodersStarted(): number`, for tests
  - The asset server answers `GET <video url>?frame=<n>&reader=<r>` with `image/jpeg`.

- [ ] **Step 1: Write the failing tests**

Append this to `src/main/media/run.test.ts`, extending the import to include `spawnFfmpeg`:

```ts
describe('streaming through ffmpeg', () => {
  it('takes input on stdin and finishes when it ends', async () => {
    const running = spawnFfmpeg(['-f', 's16le', '-ar', '8000', '-ac', '1', '-i', 'pipe:0', '-f', 'null', '-'])
    running.process.stdin.end(Buffer.alloc(16_000))
    await expect(running.done).resolves.toBeUndefined()
  }, 60_000)

  it('fails with what ffmpeg said when it exits badly', async () => {
    const running = spawnFfmpeg(['-i', '/no/such/file.mp4', '-f', 'null', '-'])
    await expect(running.done).rejects.toThrow(/No such file or directory/)
  }, 60_000)
})
```

`src/main/render/exporter/frameSource.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg } from '../../media'
import { closeReaders, decodersStarted, footageFrame } from './frameSource'

let dir: string
let clip: string

/** A JPEG as raw RGB, through the pinned ffmpeg, so two frames can be compared pixel by pixel. */
async function pixels(jpeg: Buffer, name: string): Promise<Buffer> {
  writeFileSync(join(dir, `${name}.jpg`), jpeg)
  await runFfmpeg(['-v', 'error', '-i', join(dir, `${name}.jpg`), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-y', join(dir, `${name}.rgb`)])
  return readFileSync(join(dir, `${name}.rgb`))
}

function meanDifference(a: Buffer, b: Buffer): number {
  let total = 0
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i])
  return total / a.length
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'talkie-frames-'))
  clip = join(dir, 'clip.mp4')
  // testsrc2 changes every frame, so the wrong frame is a visibly different picture.
  await runFfmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=3', '-c:v', 'mpeg4', '-q:v', '2', '-y', clip])
}, 60_000)
afterAll(() => {
  closeReaders('t')
  rmSync(dir, { recursive: true, force: true })
})

describe('a recording’s frames, for the export', () => {
  it('hands out the exact frame asked for', async () => {
    const served = await footageFrame('t-0', clip, 45)
    await runFfmpeg(['-v', 'error', '-ss', '1.5', '-i', clip, '-frames:v', '1', '-q:v', '2', '-y', join(dir, 'ref.jpg')])
    const reference = readFileSync(join(dir, 'ref.jpg'))

    expect(served.subarray(0, 2).toString('hex')).toBe('ffd8')
    expect(meanDifference(await pixels(served, 'served'), await pixels(reference, 'reference'))).toBeLessThan(3)
  }, 60_000)

  it('keeps decoding forward for the next frames rather than starting again', async () => {
    const before = decodersStarted()
    for (let frame = 46; frame < 52; frame++) await footageFrame('t-0', clip, frame)
    expect(decodersStarted()).toBe(before)
  }, 60_000)

  it('starts again from the frame asked for when it is behind the decoder', async () => {
    const before = decodersStarted()
    await footageFrame('t-0', clip, 10)
    expect(decodersStarted()).toBe(before + 1)
  }, 60_000)

  it('keeps one decoder per tab, so tabs do not drag each other back and forth', async () => {
    const before = decodersStarted()
    await footageFrame('t-1', clip, 80)
    await footageFrame('t-0', clip, 11)
    expect(decodersStarted()).toBe(before + 1)
  }, 60_000)

  it('shows the last frame for a moment past the end, as a held recording does', async () => {
    const last = await footageFrame('t-2', clip, 89)
    expect(await footageFrame('t-2', clip, 120)).toEqual(last)
  }, 60_000)
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/media/run.test.ts src/main/render/exporter/frameSource.test.ts`

Expected: FAIL. `spawnFfmpeg` and `./frameSource` do not exist yet.

- [ ] **Step 3: Add `spawnFfmpeg` to `src/main/media/run.ts`**

```ts
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'

export type RunningTool = { process: ChildProcessWithoutNullStreams; done: Promise<void> }

/**
 * ffmpeg as a stream — frames piped in to be encoded, or decoded frames read out — for the
 * export, which cannot hold a whole video in one buffer as runFfmpeg does.
 */
export function spawnFfmpeg(args: string[], { signal }: { signal?: AbortSignal } = {}): RunningTool {
  const child = spawn(toolPath('ffmpeg'), args, { signal, stdio: ['pipe', 'pipe', 'pipe'] })
  let said = ''
  child.stderr.on('data', (chunk: Buffer) => {
    said = (said + chunk.toString('utf-8')).slice(-8000)
  })
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, killedBy) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg failed (${killedBy ?? `exit ${code}`})\n${said.trim().split('\n').slice(-12).join('\n')}`))
    })
  })
  // A closed stdin is how the exporter says it is finished; an error writing to it after a
  // failure is reported by `done`, so it is not reported twice.
  child.stdin.on('error', () => undefined)
  return { process: child, done }
}
```

Export `spawnFfmpeg` and `type RunningTool` from `src/main/media/index.ts`.

- [ ] **Step 4: Write `src/main/render/exporter/frameSource.ts`**

```ts
import { probeMedia, spawnFfmpeg, type RunningTool } from '../../media'
import { FPS } from '../../../remotion/constants'

/**
 * Frames of recordings, for the export: one ffmpeg per tab per file, decoding forward from the
 * first frame asked for and handing frames out in order. Each tab exports consecutive frames,
 * so nearly every request is the decoder's next frame. One behind the decoder, or more than two
 * seconds ahead of it, starts it again there — cheaper than decoding the gap.
 */
const RESTART_AHEAD = FPS * 2

type Decoder = {
  file: string
  /** The frame the next JPEG off the pipe will be. */
  next: number
  frames: Buffer[]
  last: Buffer | null
  ended: boolean
  waiting: (() => void) | null
  tool: RunningTool
}

const decoders = new Map<string, Decoder>()
const lastFrame = new Map<string, number>()
let started = 0

export function decodersStarted(): number {
  return started
}

async function finalFrame(file: string): Promise<number> {
  const known = lastFrame.get(file)
  if (known !== undefined) return known
  const { durationSeconds } = await probeMedia(file)
  const last = Math.max(0, Math.floor((durationSeconds ?? 0) * FPS) - 1)
  lastFrame.set(file, last)
  return last
}

function start(file: string, from: number): Decoder {
  started++
  // -ss before -i seeks to the nearest keyframe and decodes on to the exact moment; fps= then
  // gives one picture per composition frame, whatever rate the recording was made at.
  const tool = spawnFfmpeg(['-v', 'error', '-ss', (from / FPS).toFixed(4), '-i', file, '-vf', `fps=${FPS}`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '2', 'pipe:1'])
  const decoder: Decoder = { file, next: from, frames: [], last: null, ended: false, waiting: null, tool }
  let pending = Buffer.alloc(0)
  tool.process.stdout.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk])
    // A JPEG ends at FF D9; inside one, a literal FF is always followed by 00, so that pair
    // marks the end of a frame and nothing else.
    for (let end = pending.indexOf(EOI); end !== -1; end = pending.indexOf(EOI)) {
      decoder.frames.push(pending.subarray(0, end + 2))
      pending = pending.subarray(end + 2)
    }
    decoder.waiting?.()
  })
  const finish = (): void => {
    decoder.ended = true
    decoder.waiting?.()
  }
  tool.done.then(finish, finish)
  return decoder
}

const EOI = Buffer.from([0xff, 0xd9])

async function take(decoder: Decoder): Promise<Buffer | null> {
  while (decoder.frames.length === 0 && !decoder.ended) await new Promise<void>((resolve) => (decoder.waiting = resolve))
  decoder.waiting = null
  const frame = decoder.frames.shift() ?? null
  if (frame) {
    decoder.last = frame
    decoder.next++
  }
  return frame
}

export async function footageFrame(reader: string, file: string, frame: number): Promise<Buffer> {
  const wanted = Math.min(frame, await finalFrame(file))
  const key = `${reader}\u0000${file}`
  let decoder = decoders.get(key)
  const behind = decoder && wanted < decoder.next - 1
  const tooFar = decoder && wanted > decoder.next + RESTART_AHEAD
  if (!decoder || behind || tooFar) {
    decoder?.tool.process.kill()
    decoder = start(file, wanted)
    decoders.set(key, decoder)
  }
  // The frame handed out last time, asked for again (a held frame), is still the last one taken.
  if (wanted === decoder.next - 1 && decoder.last) return decoder.last
  while (decoder.next <= wanted) {
    const taken = await take(decoder)
    if (!taken) break
  }
  if (!decoder.last) throw new Error(`No frame ${wanted} in ${file}`)
  return decoder.last
}

/** Stops every decoder an export's tabs started. Their readers all begin `<export id>-`. */
export function closeReaders(prefix: string): void {
  for (const [key, decoder] of decoders) {
    if (key.startsWith(`${prefix}-`)) {
      decoder.tool.process.kill()
      decoders.delete(key)
    }
  }
}
```

- [ ] **Step 5: Answer frame requests in the asset server**

In `src/main/render/assetServer.ts`, import `footageFrame` from `./exporter/frameSource`. Find the line `const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'`, and insert this immediately before it:

```ts
      // A recording's frame, for the export page — see exporter/frameSource.ts. On the video's
      // own URL, so the per-run secret and the projects-folder boundary apply exactly as they do
      // to the video itself.
      const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
      const asked = query.get('frame')
      if (asked !== null && ['.mp4', '.webm'].includes(extname(filePath).toLowerCase())) {
        const frame = Number(asked)
        if (!Number.isInteger(frame) || frame < 0) {
          refuse()
          return
        }
        footageFrame(query.get('reader') ?? '', filePath, frame).then(
          (jpeg) => {
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpeg.length, 'Cache-Control': 'no-store' })
            res.end(jpeg)
          },
          (err: unknown) => {
            console.error(`Could not decode frame ${frame} of ${filePath}:`, err)
            refuse()
          }
        )
        return
      }
```

Add a test to `src/main/render/assetServer.test.ts`. Read that file's existing helpers first, and reuse its server-starting pattern. The test should:
1. Generate the same `testsrc2` mp4 under the server's root.
2. Fetch `<its url>?frame=3&reader=x-0`.
3. Assert the response is 200 `image/jpeg` and the body starts with `ff d8`.
4. Fetch `?frame=-1` and assert 404.

Name the test "hands the export a recording’s frame from the video’s own URL", and give it 60 s.

In `afterEach` (or the test's own end), call `closeReaders('x')`.

- [ ] **Step 6: Run the tests and the guards**

Run: `npx vitest run src/main/media src/main/render/exporter src/main/render/assetServer.test.ts src/video/videoBoundary.test.ts && npm run typecheck`

Expected: PASS. `mediaBoundary.test.ts` still passes, because the new spawn lives in `src/main/media`.

- [ ] **Step 7: Commit**

```bash
git add src/main/media/run.ts src/main/media/index.ts src/main/media/run.test.ts src/main/render/exporter/frameSource.ts src/main/render/exporter/frameSource.test.ts src/main/render/assetServer.ts src/main/render/assetServer.test.ts
git commit -m "$(cat <<'EOF'
Serve a recording's exact frame for the export, decoded by Talkie's ffmpeg

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The export page

**Files:**
- Create:
  - `src/video/exportPage/page.tsx`, `src/video/exportPage/index.html`
  - `scripts/bundleExportPage.mjs`
  - `src/main/render/exporter/exportPage.ts`, `src/main/render/exporter/exportPage.test.ts`
- Modify: `src/main/render/assetServer.ts` (`/__talkie/export/…`), `package.json` (`build`, `build:exportpage`), `electron-builder.yml` (`asarUnpack`), `tsconfig.web.json` (nothing to add; `src/video/**` is already included)

**Interfaces:**
- Consumes: `chooseOwnRenderer`, `VideoRoot`, `whenSettled` and `setFrameReader` from `src/video`, `DemoComposition`, and `FPS`/`WIDTH`/`HEIGHT`.
- Produces:
  - In the page:
    - `window.talkie.load(input: ExportPageInput): Promise<void>`, which resolves when frame 0 is drawn, fonts are loaded and nothing is held.
    - `window.talkie.seek(frame: number): Promise<void>`, which resolves when that frame is drawn and nothing is held, and rejects with `"<hold label or failure> (frame <n>)"`.
  - `type ExportPageInput = { timeline: TimelineItem[]; theme: RenderTheme | null; fps: number; width: number; height: number; durationInFrames: number; reader: string }`, exported from `src/video/exportPage/page.tsx` as a type only.
  - `exportPageResource(name: 'index.html' | 'page.js'): { path: string; type: string } | null`
  - The asset server serves `<base>/__talkie/export/index.html` and `<base>/__talkie/export/page.js`.

- [ ] **Step 1: Write the page**

`src/video/exportPage/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; padding: 0; overflow: hidden; }
      #root { position: relative; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script src="page.js"></script>
  </body>
</html>
```

`src/video/exportPage/page.tsx`:

```tsx
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { DemoComposition } from '../../remotion/DemoComposition'
import type { TimelineItem } from '../../remotion/types'
import type { RenderTheme } from '../../remotion/renderTheme'
import { chooseOwnRenderer, setFrameReader, VideoRoot, whenSettled } from '..'

/**
 * The page the export draws in: the same composition the preview plays, on Talkie's own clock.
 * One per tab. The exporter loads it, then asks for each frame of its range in turn and takes a
 * screenshot once the frame says it is drawn.
 */
export type ExportPageInput = {
  timeline: TimelineItem[]
  theme: RenderTheme | null
  fps: number
  width: number
  height: number
  durationInFrames: number
  reader: string
}

chooseOwnRenderer()

let root: Root | null = null
let input: ExportPageInput | null = null

function draw(frame: number): void {
  if (!root || !input) throw new Error('The export page has not been loaded.')
  const { timeline, theme, fps, width, height, durationInFrames } = input
  // Synchronously, so the frame's effects — and the holds they open — exist before we wait.
  flushSync(() =>
    root!.render(
      <VideoRoot frame={frame} fps={fps} width={width} height={height} durationInFrames={durationInFrames} mode="export">
        <DemoComposition timeline={timeline} theme={theme} />
      </VideoRoot>
    )
  )
}

const nextPaint = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

async function settle(): Promise<void> {
  // Passive effects of a synchronous render have run by now; a task boundary makes sure.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await whenSettled()
  await nextPaint()
}

declare global {
  interface Window {
    talkie: { load: (input: ExportPageInput) => Promise<void>; seek: (frame: number) => Promise<void> }
  }
}

window.talkie = {
  async load(given) {
    input = given
    setFrameReader(given.reader)
    const element = document.getElementById('root')!
    element.style.width = `${given.width}px`
    element.style.height = `${given.height}px`
    root = createRoot(element)
    draw(0)
    await document.fonts.ready
    await settle()
  },
  async seek(frame) {
    draw(frame)
    try {
      await settle()
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : String(err)} (frame ${frame})`)
    }
  }
}
```

- [ ] **Step 2: Build it, and find it from the main process**

`scripts/bundleExportPage.mjs`:

```js
/**
 * Builds the export page — the composition on Talkie's own clock — into out/export-page, beside
 * out/main and out/mcp. Served by the asset server and resolved from __dirname: see
 * src/main/render/exporter/exportPage.ts.
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'out/export-page')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
await build({
  entryPoints: [join(root, 'src/video/exportPage/page.tsx')],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: join(out, 'page.js')
})
cpSync(join(root, 'src/video/exportPage/index.html'), join(out, 'index.html'))
console.log(`Export page built into ${out}`)
```

`src/main/render/exporter/exportPage.ts`:

```ts
import { existsSync, mkdtempSync, copyFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join, sep } from 'path'

/**
 * The export page, wherever this build keeps it: out/export-page in a build (unpacked from the
 * archive, because a headless browser fetches it and only Node can read inside an asar), or
 * built from the sources on first use in a checkout — as the HTML scene runtime is
 * (htmlScene/resources.ts).
 */
export function shippedDir(fromDir: string = __dirname): string {
  return join(fromDir.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`), '..', 'export-page')
}

let built: string | null = null
function builtInCheckout(): string {
  if (built) return built
  // esbuild is a build tool: loaded only here, in a checkout, never by a packaged build.
  const { buildSync } = createRequire(__filename)('esbuild') as typeof import('esbuild')
  const out = mkdtempSync(join(tmpdir(), 'talkie-export-page-'))
  const root = join(__dirname, '..', '..', '..', '..')
  buildSync({
    entryPoints: [join(root, 'src/video/exportPage/page.tsx')],
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: join(out, 'page.js')
  })
  copyFileSync(join(root, 'src/video/exportPage/index.html'), join(out, 'index.html'))
  built = out
  return out
}

const TYPES = { 'index.html': 'text/html; charset=utf-8', 'page.js': 'text/javascript; charset=utf-8' } as const

export function exportPageResource(name: string): { path: string; type: string } | null {
  if (!(name in TYPES)) return null
  const shipped = shippedDir()
  const dir = existsSync(join(shipped, 'page.js')) ? shipped : builtInCheckout()
  return { path: join(dir, name), type: TYPES[name as keyof typeof TYPES] }
}
```

From this file, `__dirname` is `src/main/render/exporter` in the sources. That puts the repository root four levels up (`..`×4), as written. In a build, `__dirname` is `out/main` and `shippedDir` finds `out/export-page`. Check both paths when you test.

In `src/main/render/assetServer.ts`, in the `/__talkie/` branch, add a check before `htmlSceneResource`:

```ts
      if (afterSecret.startsWith('/__talkie/export/')) {
        const resource = exportPageResource(afterSecret.slice('/__talkie/export/'.length))
        if (!resource || !existsSync(resource.path)) {
          refuse()
          return
        }
        res.writeHead(200, {
          'Content-Type': resource.type,
          // The export page draws from this server and nowhere else. Scenes' frames are allowed
          // from here only, as in every other host (see AGENTS.md's security invariants).
          ...(resource.path.endsWith('index.html')
            ? { 'Content-Security-Policy': "default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src http://127.0.0.1:*" }
            : {})
        })
        createReadStream(resource.path).pipe(res)
        return
      }
```

Import `exportPageResource` from `./exporter/exportPage`.

In `package.json`:
- add `"build:exportpage": "node scripts/bundleExportPage.mjs",` after `build:htmlscene`;
- append ` && npm run build:exportpage` to `build`.

In `electron-builder.yml` `asarUnpack`, add after `out/html-scene/**`:

```yaml
  # The export page, fetched by the headless browser the export draws in. See exporter/exportPage.ts.
  - out/export-page/**
```

- [ ] **Step 3: Write the test**

`src/main/render/exporter/exportPage.test.ts` drives the real page in the headless shell. It uses the patterns `htmlSceneExport.test.ts` already uses for its project:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { chromium, type Browser } from 'playwright'
import { join } from 'path'
import { addTimelineItem, createProject, readTimelineLenient } from '../../project/projectApi'
import { projectsRootDir } from '../../project/paths'
import { browserExecutablePath } from '../../capture/resolveBrowser'
import { closeAssetServer, getAssetServer, resolveTimelineAssetUrls } from '../assetServer'
import { FPS, HEIGHT, WIDTH } from '../../../remotion/constants'
import type { TimelineItem } from '../../../remotion/types'

let baseDir: string
let browser: Browser | null = null
afterEach(async () => {
  await browser?.close()
  browser = null
  await closeAssetServer()
  rmSync(baseDir, { recursive: true, force: true })
})

async function openPage(items: object[]) {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-export-page-'))
  const project = createProject('Page', baseDir)
  for (const item of items) addTimelineItem(project.id, item as never, baseDir)
  const root = projectsRootDir(baseDir)
  const server = await getAssetServer(root)
  const timeline = resolveTimelineAssetUrls(readTimelineLenient(project.id, baseDir) as unknown as TimelineItem[], root, server.url)
  browser = await chromium.launch({ executablePath: browserExecutablePath() ?? undefined, headless: true })
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${server.url}/__talkie/export/index.html`)
  await page.evaluate((input) => window.talkie.load(input), { timeline, theme: null, fps: FPS, width: WIDTH, height: HEIGHT, durationInFrames: 120, reader: 'test-0' })
  return { page, errors }
}

describe('the export page', () => {
  it('draws a slide on Talkie’s own clock, frame by frame, with nothing logged', async () => {
    const { page, errors } = await openPage([{ kind: 'scene', start: 0, duration: 120, data: { title: 'Why teams switch', bullets: ['One', 'Two'] } }])
    await page.evaluate(() => window.talkie.seek(60))
    const text = await page.locator('#root').innerText()

    expect(text).toContain('Why teams switch')
    expect(errors).toEqual([])
  }, 120_000)

  it('mounts a clip only while the frame is inside it', async () => {
    const { page } = await openPage([
      { kind: 'scene', start: 0, duration: 30, data: { title: 'First', bullets: [] } },
      { kind: 'scene', start: 30, duration: 90, data: { title: 'Second', bullets: [] } }
    ])
    await page.evaluate(() => window.talkie.seek(45))

    expect(await page.locator('#root').innerText()).not.toContain('First')
    expect(await page.locator('#root').innerText()).toContain('Second')
  }, 120_000)
})
```

Read the `scene` kind's data schema in `src/main/project/timeline/schema.ts` before running. If `title`/`bullets` are not its field names, use the real ones. If `addTimelineItem` takes a different argument shape, match `htmlSceneExport.test.ts`'s call. Report any change.

- [ ] **Step 4: Run it**

Run: `npx vitest run src/main/render/exporter/exportPage.test.ts`

Expected: PASS, 2 tests. If the page logs an error, it is a real bug and must be fixed, not filtered; AGENTS.md says the same for the window. Typical causes:
- a `process` or `global` reference in a bundled dependency: add it to `define`, in both builders;
- a missing CSS rule.

- [ ] **Step 5: Build it as a build would, and type-check**

Run: `npm run build:exportpage && ls out/export-page && npm run typecheck`

Expected: `index.html page.js`, and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/video/exportPage scripts/bundleExportPage.mjs src/main/render/exporter/exportPage.ts src/main/render/exporter/exportPage.test.ts src/main/render/assetServer.ts package.json electron-builder.yml
git commit -m "$(cat <<'EOF'
Draw the composition for export on a page of Talkie's own

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The exporter

**Files:**
- Create:
  - `src/main/render/exporter/ranges.ts`
  - `src/main/render/exporter/soundtrack.ts`
  - `src/main/render/exporter/exportVideo.ts`
  - `src/main/render/exporter/ranges.test.ts`
  - `src/main/render/exporter/soundtrack.test.ts`
  - `src/main/render/exporter/exportVideo.test.ts`
- Modify:
  - `src/main/media/encoders.ts` (the `'export'` purpose)
  - `src/main/media/encoders.test.ts`
  - `src/main/render/exportProgress.ts` (`drawing`, `encoding`)
  - `src/main/render/exportProgress.test.ts`

**Interfaces:**
- Consumes:
  - `spawnFfmpeg`, `runFfmpeg` and `h264` from `src/main/media`
  - `closeReaders` from Task 2
  - the export page from Task 3
  - `browserExecutablePath`
  - `NARRATION_LEAD_IN_FRAMES` and `FPS`
- Produces:
  - `tabCount(cpus?: number): number`
  - `splitFrames(total: number, tabs: number): { from: number; to: number }[]`, where each range runs from `from` (inclusive) to `to` (exclusive)
  - `type Take = { path: string; startFrame: number; maxFrames: number }`
  - `takesFor(timeline: { id: string; start: number; duration: number }[], narration: Map<string, { path: string }>): Take[]`
  - `soundtrackArgs(takes: Take[], totalFrames: number, output: string): string[]`
  - `exportVideo(input: OwnExportInput): Promise<void>`
  - `type OwnExportInput = { timeline: TimelineItem[]; rawTimeline: TimelineItem[]; theme: RenderTheme | null; totalFrames: number; narration: Map<string, { path: string }>; serverUrl: string; outputPath: string; onProgress?: (progress: ExportProgress) => void; signal?: AbortSignal }`
  - `type EncodePurpose = 'intermediate' | 'export'`
  - `drawing(rendered: number, total: number): ExportProgress`
  - `encoding(total: number): ExportProgress`

- [ ] **Step 1: Write the failing tests**

`src/main/render/exporter/ranges.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { splitFrames, tabCount } from './ranges'

describe('sharing the frames out between tabs', () => {
  it('uses half the cores, at least one tab and at most six', () => {
    expect(tabCount(10)).toBe(5)
    expect(tabCount(1)).toBe(1)
    expect(tabCount(32)).toBe(6)
  })

  it('gives each tab one run of consecutive frames, covering the video exactly once', () => {
    const ranges = splitFrames(1711, 5)
    expect(ranges[0].from).toBe(0)
    expect(ranges.at(-1)!.to).toBe(1711)
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].from).toBe(ranges[i - 1].to)
    expect(Math.max(...ranges.map((r) => r.to - r.from)) - Math.min(...ranges.map((r) => r.to - r.from))).toBeLessThanOrEqual(1)
  })

  it('never makes an empty range for a video shorter than the tabs', () => {
    expect(splitFrames(3, 5)).toEqual([{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }])
  })
})
```

`src/main/render/exporter/soundtrack.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { probeMedia, runFfmpeg } from '../../media'
import { NARRATION_LEAD_IN_FRAMES } from '../../../remotion/constants'
import { soundtrackArgs, takesFor } from './soundtrack'

let dir: string
beforeAll(() => void (dir = mkdtempSync(join(tmpdir(), 'talkie-soundtrack-'))))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('the soundtrack', () => {
  it('starts each take a beat into its clip and stops it at the clip’s end', () => {
    const takes = takesFor(
      [{ id: 'a', start: 0, duration: 90 }, { id: 'b', start: 90, duration: 60 }, { id: 'c', start: 150, duration: 30 }],
      new Map([['a', { path: '/a.wav' }], ['b', { path: '/b.wav' }]])
    )
    expect(takes).toEqual([
      { path: '/a.wav', startFrame: NARRATION_LEAD_IN_FRAMES, maxFrames: 90 - NARRATION_LEAD_IN_FRAMES },
      { path: '/b.wav', startFrame: 90 + NARRATION_LEAD_IN_FRAMES, maxFrames: 60 - NARRATION_LEAD_IN_FRAMES }
    ])
  })

  it('puts the voice where the picture is, for exactly the video’s length', async () => {
    await runFfmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-y', join(dir, 'long.wav')])
    const out = join(dir, 'track.m4a')
    // 4 s of clip, 0.6 s lead-in: the 5 s take is cut at 3.4 s of speech, ending at 4 s.
    await runFfmpeg(soundtrackArgs([{ path: join(dir, 'long.wav'), startFrame: 18, maxFrames: 102 }], 180, out))
    const { stderr } = await runFfmpeg(['-i', out, '-af', 'silencedetect=n=-45dB:d=0.2', '-f', 'null', '-'])
    const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]))
    const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))

    expect(ends[0]).toBeCloseTo(0.6, 1)
    expect(starts.at(-1)).toBeCloseTo(4, 1)
    expect((await probeMedia(out)).durationSeconds).toBeCloseTo(6, 1)
  }, 60_000)

  it('is a silent track of the right length when nothing is narrated, as Remotion’s always was', async () => {
    const out = join(dir, 'silent.m4a')
    await runFfmpeg(soundtrackArgs([], 90, out))

    expect((await probeMedia(out)).durationSeconds).toBeCloseTo(3, 1)
  }, 60_000)
})
```

`src/main/render/exporter/exportVideo.test.ts` exports a two-clip project end to end through `exportVideo`. Model it on `htmlSceneExport.test.ts`: a temp `baseDir`, `createProject`, and two `scene` items of 45 frames each. Resolve the timeline as Task 3's test does, then call `exportVideo` with `totalFrames: 90`, an empty narration map and `outputPath` in the temp dir.

It asserts:
- `probeMedia(output)` gives `{ width: 1920, height: 1080, fps: 30, videoCodec: 'h264', hasAudio: true }`, and `durationSeconds` close to 3 at 1 decimal place;
- the frame count is 90 (`runFfprobe(['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','csv=p=0', out])` gives `90`);
- no `.parts-` folder is left beside the output;
- a second run with an `AbortController` aborted after the first progress report of stage `rendering` rejects, leaves no `.parts-` folder, and leaves no ffmpeg or browser process started by it. Check that last one with `decodersStarted` unchanged, and by the call resolving within 15 s.

Name the tests:
- "exports every frame to an H.264 file with a soundtrack, and tidies up after itself"
- "stops when cancelled, leaving nothing behind"

Each gets 180 s.

Add to `src/main/render/exportProgress.test.ts`:

```ts
  it('moves through drawing as frames are captured, and holds a share back for encoding', () => {
    expect(drawing(0, 100).stage).toBe('rendering')
    expect(drawing(50, 100).fraction).toBeGreaterThan(drawing(10, 100).fraction)
    expect(drawing(100, 100).fraction).toBeLessThan(encoding(100).fraction)
    expect(encoding(100).stage).toBe('encoding')
    expect(encoding(100).fraction).toBeLessThan(finishing(100).fraction)
  })
```

Add to `src/main/media/encoders.test.ts`:

```ts
  it('asks the hardware encoder for the export at its own quality', () => {
    const args = chooseH264('darwin', new Set(['h264_videotoolbox']), 'export')
    expect(args.slice(0, 2)).toEqual(['-c:v', 'h264_videotoolbox'])
    expect(args).toContain('-q:v')
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/render/exporter src/main/render/exportProgress.test.ts src/main/media/encoders.test.ts`

Expected: FAIL. The new modules and functions are missing.

- [ ] **Step 3: Write `ranges.ts` and `soundtrack.ts`**

`src/main/render/exporter/ranges.ts`:

```ts
import { cpus } from 'os'

/** Half the cores, one to six: each tab is a browser renderer and an ffmpeg encoding beside it. */
export function tabCount(cores: number = cpus().length): number {
  return Math.min(6, Math.max(1, Math.floor(cores / 2)))
}

/** Consecutive runs, as equal as frames allow, so each tab's recording decoder only goes forward. */
export function splitFrames(total: number, tabs: number): { from: number; to: number }[] {
  const count = Math.max(1, Math.min(tabs, total))
  const ranges: { from: number; to: number }[] = []
  for (let i = 0; i < count; i++) {
    ranges.push({ from: Math.round((total * i) / count), to: Math.round((total * (i + 1)) / count) })
  }
  return ranges
}
```

`src/main/render/exporter/soundtrack.ts`:

```ts
import { FPS, NARRATION_LEAD_IN_FRAMES } from '../../../remotion/constants'

/**
 * The export's sound, mixed from the timeline rather than recorded off the page: each take
 * placed where the composition plays it and cut where its clip ends, as Remotion's mix did.
 * Recordings are silent, so takes are all there is.
 */
export type Take = { path: string; startFrame: number; maxFrames: number }

export function takesFor(timeline: { id: string; start: number; duration: number }[], narration: Map<string, { path: string }>): Take[] {
  return timeline.flatMap((item) => {
    const take = narration.get(item.id)
    const maxFrames = item.duration - NARRATION_LEAD_IN_FRAMES
    return take && maxFrames > 0 ? [{ path: take.path, startFrame: item.start + NARRATION_LEAD_IN_FRAMES, maxFrames }] : []
  })
}

const seconds = (frames: number): string => (frames / FPS).toFixed(4)

export function soundtrackArgs(takes: Take[], totalFrames: number, output: string): string[] {
  const length = ['-t', seconds(totalFrames)]
  const encode = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']
  if (takes.length === 0) {
    return ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', ...length, ...encode, '-y', output]
  }
  const inputs = takes.flatMap((take) => ['-i', take.path])
  const placed = takes.map((take, i) => {
    const delay = Math.round((take.startFrame / FPS) * 1000)
    return `[${i}:a]atrim=end=${seconds(take.maxFrames)},aformat=sample_rates=48000:channel_layouts=stereo,adelay=delays=${delay}:all=1[t${i}]`
  })
  // Summed, not averaged: takes do not overlap, and amix's default would quieten each by the count.
  const mix = `${takes.map((_, i) => `[t${i}]`).join('')}amix=inputs=${takes.length}:normalize=0:dropout_transition=0,apad[out]`
  return ['-v', 'error', ...inputs, '-filter_complex', [...placed, mix].join(';'), '-map', '[out]', ...length, ...encode, '-y', output]
}
```

- [ ] **Step 4: Progress, and the export encoder row**

In `src/main/render/exportProgress.ts`, after `rendering`, add:

```ts
/** Talkie's own export: capturing is most of the middle, the rest is joining and mixing. */
const DRAWING_SHARE = 0.9

export function drawing(renderedFrames: number, totalFrames: number): ExportProgress {
  const done = totalFrames > 0 ? clamp(renderedFrames / totalFrames) : 0
  return {
    stage: 'rendering',
    fraction: PREPARING + done * DRAWING_SHARE * (1 - PREPARING - FINISHING),
    renderedFrames: Math.min(renderedFrames, totalFrames),
    totalFrames
  }
}

export function encoding(totalFrames: number): ExportProgress {
  return { stage: 'encoding', fraction: PREPARING + DRAWING_SHARE * (1 - PREPARING - FINISHING), renderedFrames: totalFrames, totalFrames }
}
```

Leave `rendering(report, …)` as it is; the Remotion path keeps using it.

In `src/main/media/encoders.ts`:
- Change `export type EncodePurpose = 'intermediate'` to `'intermediate' | 'export'`, and change its comment to "What an encode is for: a stitched recording, or the video someone is given."
- Change the darwin row to `quality: { intermediate: ['-q:v', '65'], export: ['-q:v', EXPORT_QUALITY] }`.
- Add the constant above the table:

```ts
/**
 * The export's quality on VideoToolbox. Provisional until Task 6 of step 3 sets it to the value
 * that brings the comparison fixtures within 10% of Remotion's file sizes, and records why here.
 */
const EXPORT_QUALITY = '65'
```

- [ ] **Step 5: Write `src/main/render/exporter/exportVideo.ts`**

```ts
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { dirname, join } from 'path'
import { chromium, type Browser, type Page } from 'playwright'
import type { TimelineItem } from '../../../remotion/types'
import type { RenderTheme } from '../../../remotion/renderTheme'
import { FPS, HEIGHT, WIDTH } from '../../../remotion/constants'
import { h264, runFfmpeg, spawnFfmpeg, type RunningTool } from '../../media'
import { browserExecutablePath } from '../../capture/resolveBrowser'
import { drawing, encoding, type ExportProgress } from '../exportProgress'
import { closeReaders } from './frameSource'
import { splitFrames, tabCount } from './ranges'
import { soundtrackArgs, takesFor } from './soundtrack'

export type OwnExportInput = {
  /** Resolved for the page: asset-server URLs, captions, beats. */
  timeline: TimelineItem[]
  /** As stored, for the soundtrack: clip positions and lengths. */
  rawTimeline: TimelineItem[]
  theme: RenderTheme | null
  totalFrames: number
  narration: Map<string, { path: string }>
  serverUrl: string
  outputPath: string
  onProgress?: (progress: ExportProgress) => void
  signal?: AbortSignal
}

/** High-definition colour, said and done: converted with BT.709 and tagged so, not BT.601's PAL. */
const COLOUR = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']

/**
 * Talkie's own export (spec §3): N headless tabs each draw a run of frames and pipe their
 * screenshots to an ffmpeg of their own; the runs are joined without re-encoding, and the
 * soundtrack is mixed from the timeline and muxed in.
 */
export async function exportVideo(input: OwnExportInput): Promise<void> {
  const { totalFrames, outputPath, onProgress, signal } = input
  const id = randomBytes(4).toString('hex')
  const parts = join(dirname(outputPath), `.parts-${id}`)
  mkdirSync(parts, { recursive: true })
  // Our own, so a failure in one tab stops the others as a cancel would.
  const stop = new AbortController()
  const forward = (): void => stop.abort()
  signal?.addEventListener('abort', forward)
  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ executablePath: browserExecutablePath() ?? undefined, headless: true })
    const ranges = splitFrames(totalFrames, tabCount())
    const encode = await h264('export')
    let rendered = 0
    const segments = await Promise.all(
      ranges.map(async (range, tab) => {
        const segment = join(parts, `segment-${String(tab).padStart(2, '0')}.mp4`)
        try {
          await captureRange(browser!, input, `${id}-${tab}`, range, segment, encode, stop.signal, () => {
            rendered++
            onProgress?.(drawing(rendered, totalFrames))
          })
        } catch (err) {
          stop.abort()
          throw err
        }
        return segment
      })
    )
    signal?.throwIfAborted()

    onProgress?.(encoding(totalFrames))
    const list = join(parts, 'segments.txt')
    writeFileSync(list, segments.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join('\n') + '\n')
    const video = join(parts, 'video.mp4')
    await runFfmpeg(['-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-y', video], { signal: stop.signal })
    const sound = join(parts, 'soundtrack.m4a')
    await runFfmpeg(soundtrackArgs(takesFor(input.rawTimeline, input.narration), totalFrames, sound), { signal: stop.signal })
    await runFfmpeg(['-v', 'error', '-i', video, '-i', sound, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', '-y', outputPath], { signal: stop.signal })
  } finally {
    signal?.removeEventListener('abort', forward)
    stop.abort()
    await browser?.close().catch(() => undefined)
    closeReaders(id)
    rmSync(parts, { recursive: true, force: true })
  }
}

async function captureRange(
  browser: Browser,
  input: OwnExportInput,
  reader: string,
  range: { from: number; to: number },
  segment: string,
  encode: string[],
  signal: AbortSignal,
  captured: () => void
): Promise<void> {
  const page: Page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
  const crashed = new Promise<never>((_, reject) => page.on('crash', () => reject(new Error(`The export tab drawing frames ${range.from}–${range.to - 1} crashed`))))
  crashed.catch(() => undefined)
  await page.goto(`${input.serverUrl}/__talkie/export/index.html`)
  await page.evaluate((given) => window.talkie.load(given), {
    timeline: input.timeline,
    theme: input.theme,
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    durationInFrames: input.totalFrames,
    reader
  })
  const cdp = await page.context().newCDPSession(page)
  const encoder: RunningTool = spawnFfmpeg(
    ['-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', ...COLOUR, ...encode, '-r', String(FPS), '-an', '-y', segment],
    { signal }
  )
  try {
    for (let frame = range.from; frame < range.to; frame++) {
      signal.throwIfAborted()
      await Promise.race([page.evaluate((f) => window.talkie.seek(f), frame), crashed])
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 })
      if (!encoder.process.stdin.write(Buffer.from(data, 'base64'))) {
        await new Promise((resolve) => encoder.process.stdin.once('drain', resolve))
      }
      captured()
    }
    encoder.process.stdin.end()
    await encoder.done
  } finally {
    encoder.process.kill()
    await page.close().catch(() => undefined)
  }
}
```

`window.talkie` is declared in the page module, and the main process's tsconfig does not see it. Add a local declaration at the top of `exportVideo.ts`:

```ts
declare global {
  interface Window {
    talkie: { load: (input: unknown) => Promise<void>; seek: (frame: number) => Promise<void> }
  }
}
```

Do the same in `exportPage.test.ts` if typecheck asks for it. The main tsconfig has no DOM `lib`, so if `Window` is unknown there, use `(window as unknown as { talkie: … }).talkie` inside the `evaluate` callbacks instead. Report which way you went.

- [ ] **Step 6: Run the tests and the types**

Run: `npx vitest run src/main/render/exporter src/main/render/exportProgress.test.ts src/main/media && npm run typecheck`

Expected: PASS. If the exported file's frame count is not 90, the usual causes are `-r` or `-framerate`. Fix the arguments, never the expectation.

- [ ] **Step 7: Commit**

```bash
git add src/main/render/exporter src/main/media/encoders.ts src/main/media/encoders.test.ts src/main/render/exportProgress.ts src/main/render/exportProgress.test.ts
git commit -m "$(cat <<'EOF'
Export frame by frame from headless tabs into Talkie's own ffmpeg

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Export with it by default, Remotion's kept beside it

**Files:**
- Create: `src/main/render/remotionExport.ts`
- Modify:
  - `src/main/render/renderProject.ts`
  - `src/main/render/exportJob.ts`, `src/main/render/exportJob.test.ts`
  - `src/main/render/exportFromAnywhere.test.ts`
  - `src/main/render/packagedBinaries.test.ts` (its `CALLS_A_BINARY` file names)

**Interfaces:**
- `RenderOptions` becomes:

  ```ts
  { onProgress?: (progress: ExportProgress) => void; signal?: AbortSignal; renderer?: 'own' | 'remotion' }
  ```

- `renderWithRemotion(input: { timeline; theme; totalFrames; outputPath; onProgress; signal }): Promise<void>` holds today's `selectComposition` + `renderMedia` code.

- [ ] **Step 1: Move Remotion's export out of `renderProject.ts`**

Create `src/main/render/remotionExport.ts` holding the current `remotionBundleLocation`, `browserExecutablePath`, `selectComposition` and `renderMedia` block, with every comment kept. Its signature is:

```ts
export async function renderWithRemotion({
  timeline,
  theme,
  totalFrames,
  outputPath,
  onProgress,
  signal
}: {
  timeline: RemotionTimelineItem[]
  theme: RenderTheme | null
  totalFrames: number
  outputPath: string
  onProgress?: (progress: ExportProgress) => void
  signal?: AbortSignal
}): Promise<void>
```

Inside, adapt the signal before calling `renderMedia`:

```ts
  // Remotion takes its own cancel signal; the rest of Talkie speaks AbortSignal.
  const { cancelSignal, cancel } = makeCancelSignal()
  if (signal?.aborted) cancel()
  signal?.addEventListener('abort', () => cancel(), { once: true })
```

Pass `cancelSignal` to `renderMedia`. Give the file a docblock:

```ts
/**
 * Remotion's export, kept beside Talkie's own until the comparison test (exporter/compare/) has
 * shown the two agree and step 5 of the renderer removes it. `TALKIE_RENDERER=remotion` chooses it.
 */
```

- [ ] **Step 2: Choose between them in `renderProject.ts`**

- Replace the moved block with:

  ```ts
  const renderer = options.renderer ?? (process.env.TALKIE_RENDERER === 'remotion' ? 'remotion' : 'own')
  if (renderer === 'remotion') {
    await renderWithRemotion({ timeline, theme, totalFrames, outputPath, onProgress, signal })
  } else {
    await exportVideo({ timeline, rawTimeline, theme, totalFrames, narration: narrationAudioPaths, serverUrl: assetServer.url, outputPath, onProgress, signal })
  }
  ```

- Change the signature's destructuring to `{ onProgress, signal, renderer }`, read from `options`.
- Remove the now-unused imports: `renderMedia`, `selectComposition`, `CancelSignal`, `binariesDirectory`, `remotionBundleLocation`, `browserExecutablePath` and `COMPOSITION_ID`.
- In `RenderOptions`:
  - replace the `cancelSignal` field with `signal?: AbortSignal`, with the comment "Stops the export part way; it then rejects.";
  - add `renderer?: 'own' | 'remotion'`, with the comment "Which exporter; `TALKIE_RENDERER`, then Talkie's own, when not given."

`readNarrationAudioPaths` returns `Map<string, NarrationAudio>`, which has `path`. Check the type before you pass it as `narration`.

- [ ] **Step 3: Cancel with an AbortController**

In `src/main/render/exportJob.ts`, remove the `@remotion/renderer` import, then:
- replace `const { cancelSignal, cancel } = makeCancelSignal()` with `const controller = new AbortController()`;
- pass `{ onProgress, signal: controller.signal }`;
- change `cancel()` in the job to `controller.abort()`.

Its comment about browsers left running stays true.

Update `exportJob.test.ts` wherever it relied on `cancelSignal`; read it first. A test render that waited on the Remotion cancel callback now waits on `options.signal`'s `abort` event.

- [ ] **Step 4: Keep the "from anywhere" and packaged guards honest**

`exportFromAnywhere.test.ts` reads `renderProject.ts` for `browserExecutable` being passed to Remotion's two calls. Point it at `remotionExport.ts` for those. Then add one assertion that `exporter/exportVideo.ts` launches with `executablePath: browserExecutablePath()`, read off the source in the same manner. Reword its name if needed so it still reads as a sentence.

In `packagedBinaries.test.ts`, change the two `CALLS_A_BINARY` rows' `file` from `render/renderProject.ts` to `render/remotionExport.ts`.

- [ ] **Step 5: Run every export test on the new default**

Run: `npm run typecheck && npx vitest run src/main/render src/main/ipc src/mcp`

Expected: PASS. These now export with Talkie's own exporter: `renderProject.test.ts`, `htmlSceneExport.test.ts`, `themedExport.test.ts` and the MCP export tool's test.

Watch two tests closely:
- **`htmlSceneExport.test.ts`'s stuck-frame test.** The page never answers. `HtmlScene` releases its frame hold after 5 s and draws the frame as it is, which matches spec §3, so the export must still succeed.
- **`themedExport.test.ts`'s brand-colour patch.** It checks the colour is right.

If a test fails, find out why; it is a real difference from Remotion's export. Do not loosen it. Report each such test's output.

- [ ] **Step 6: Commit**

```bash
git add src/main/render/remotionExport.ts src/main/render/renderProject.ts src/main/render/exportJob.ts src/main/render/exportJob.test.ts src/main/render/exportFromAnywhere.test.ts src/main/render/packagedBinaries.test.ts
git commit -m "$(cat <<'EOF'
Export with Talkie's own exporter, keeping Remotion's behind TALKIE_RENDERER

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Prove it against Remotion, and set the export's quality

**Files:**
- Create:
  - `vitest.compare.config.ts`
  - `src/main/render/exporter/compare/measure.ts`
  - `src/main/render/exporter/compare/measure.test.ts`
  - `src/main/render/exporter/compare/compareExports.compare.ts`
- Modify:
  - `package.json` (`compare:renderer`)
  - `tsconfig.node.json`, so it includes `vitest.compare.config.ts`
  - `src/main/media/encoders.ts` (`EXPORT_QUALITY`)
  - the spec (§2, the export `-q:v`)

**Interfaces:**
- From `measure.ts`:
  - `frameCount(path): Promise<number>`
  - `rgbFrame(path, seconds): Promise<Buffer>` (1920×1080×3)
  - `pictureDifference(a: Buffer, b: Buffer, width: number, height: number): { mean: number; worstOutsideEdges: number }`
  - `integratedLoudness(path): Promise<number>`
  - `silences(path): Promise<{ start: number; end: number }[]>`

- [ ] **Step 1: The measures, tested on known inputs**

`src/main/render/exporter/compare/measure.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg, runFfprobe } from '../../../media'

/** What the comparison measures (spec §3, "Proof"): frames, pictures, loudness, silences. */
export async function frameCount(path: string): Promise<number> {
  const { stdout } = await runFfprobe(['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path])
  return Number(stdout.trim())
}

export async function rgbFrame(path: string, seconds: number): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-measure-'))
  try {
    const out = join(dir, 'frame.rgb')
    await runFfmpeg(['-v', 'error', '-ss', seconds.toFixed(4), '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-y', out])
    return readFileSync(out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Mean absolute per-channel difference, and the worst single difference outside a 2-pixel margin
 * of edges in either picture. Text is anti-aliased differently by any two renders; everywhere
 * else the pictures should agree closely.
 */
export function pictureDifference(a: Buffer, b: Buffer, width: number, height: number): { mean: number; worstOutsideEdges: number } {
  const luma = (buf: Buffer, i: number): number => 0.2126 * buf[i * 3] + 0.7152 * buf[i * 3 + 1] + 0.0722 * buf[i * 3 + 2]
  const edge = new Uint8Array(width * height)
  for (const buf of [a, b]) {
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const i = y * width + x
        if (Math.abs(luma(buf, i) - luma(buf, i + 1)) > 24 || Math.abs(luma(buf, i) - luma(buf, i + width)) > 24) edge[i] = 1
      }
    }
  }
  const near = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!edge[y * width + x]) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const yy = y + dy
          const xx = x + dx
          if (yy >= 0 && yy < height && xx >= 0 && xx < width) near[yy * width + xx] = 1
        }
      }
    }
  }
  let total = 0
  let worst = 0
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i * 3 + c] - b[i * 3 + c])
      total += d
      if (!near[i] && d > worst) worst = d
    }
  }
  return { mean: total / (width * height * 3), worstOutsideEdges: worst }
}

export async function integratedLoudness(path: string): Promise<number> {
  const { stderr } = await runFfmpeg(['-nostats', '-i', path, '-vn', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'])
  const match = /Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(stderr)
  if (!match) throw new Error(`No loudness reading for ${path}`)
  return Number(match[1])
}

export async function silences(path: string): Promise<{ start: number; end: number }[]> {
  const { stderr } = await runFfmpeg(['-nostats', '-i', path, '-vn', '-af', 'silencedetect=n=-45dB:d=0.25', '-f', 'null', '-'])
  const starts = [...stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]))
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
  return starts.map((start, i) => ({ start, end: ends[i] ?? Infinity }))
}
```

`measure.test.ts` checks `pictureDifference` on synthetic buffers. Use a 20×10 frame for each case:
- **Identical:** two identical buffers give `{ mean: 0, worstOutsideEdges: 0 }`.
- **A sharp edge:** a uniform grey frame and the same frame with one bright vertical line give `worstOutsideEdges` 0. The line counts as an edge, and the margin covers it.
- **A flat shift:** a uniform grey frame and one 10 levels brighter everywhere give `mean` 10 and `worstOutsideEdges` 10.

It also runs `silences` and `integratedLoudness` on a generated file: 1 s silence, 1 s sine, 1 s silence. Expect one silence starting near 0, one near 2, and a finite loudness.

Name the tests as sentences, and give the ffmpeg ones 60 s.

- [ ] **Step 2: The comparison suite**

`vitest.compare.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

/**
 * Talkie's own export against Remotion's, on the shipped examples (spec §3, "Proof"). Minutes,
 * not seconds — opt-in, run by `npm run compare:renderer`, and part of the gates while both
 * exporters exist.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/render/exporter/compare/**/*.compare.ts'],
    testTimeout: 20 * 60_000,
    hookTimeout: 20 * 60_000,
    fileParallelism: false
  }
})
```

In `package.json`, add `"compare:renderer": "vitest run -c vitest.compare.config.ts",`. In `tsconfig.node.json`, add `"vitest.compare.config.ts"` to `include`.

`src/main/render/exporter/compare/compareExports.compare.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { installExamples } from '../../../examples/installExamples'
import { listProjects, readTimelineLenient } from '../../../project/projectApi'
import { renderProjectVideo } from '../../renderProject'
import { closeAssetServer } from '../../assetServer'
import { probeMedia } from '../../../media'
import { frameCount, integratedLoudness, pictureDifference, rgbFrame, silences } from './measure'

/**
 * The spec's proof that Talkie's own export can replace Remotion's: the same shipped examples,
 * exported both ways in one run, held to the limits in spec §3. A failure here is a difference
 * someone would see or hear — investigate it; never widen a limit to pass.
 */
const FIXTURES = ['Taskboard walkthrough', 'Where does a photo go?']
const SPEED_FIXTURE = 'Taskboard walkthrough'
const FRAME = 1 / 30

let home: string
const results = new Map<string, { remotion: string; own: string; remotionSeconds: number; ownSeconds: number }>()

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'talkie-compare-'))
  installExamples(home)
  for (const name of FIXTURES) {
    const project = listProjects(home).find((p) => p.name === name)
    if (!project) throw new Error(`The ${name} example did not install`)
    const timed = async (renderer: 'own' | 'remotion'): Promise<{ path: string; seconds: number }> => {
      const started = Date.now()
      const path = await renderProjectVideo(project.id, home, { renderer })
      const kept = path.replace(/\.mp4$/, `.${renderer}.mp4`)
      copyFileSync(path, kept)
      return { path: kept, seconds: (Date.now() - started) / 1000 }
    }
    const remotion = await timed('remotion')
    const own = await timed('own')
    results.set(name, { remotion: remotion.path, own: own.path, remotionSeconds: remotion.seconds, ownSeconds: own.seconds })
    console.log(`${name}: Remotion ${remotion.seconds.toFixed(1)} s, ${statSync(remotion.path).size} bytes; own ${own.seconds.toFixed(1)} s, ${statSync(own.path).size} bytes`)
  }
})
afterAll(async () => {
  await closeAssetServer()
  rmSync(home, { recursive: true, force: true })
})

describe.each(FIXTURES)('%s, exported both ways', (name) => {
  it('has the same frames and the same length', async () => {
    const { remotion, own } = results.get(name)!
    expect(await frameCount(own)).toBe(await frameCount(remotion))
    expect((await probeMedia(own)).durationSeconds).toBeCloseTo((await probeMedia(remotion)).durationSeconds!, 1)
  })

  it('looks the same at five moments in every clip', async () => {
    const { remotion, own } = results.get(name)!
    const project = listProjects(home).find((p) => p.name === name)!
    const timeline = readTimelineLenient(project.id, home) as { start: number; duration: number }[]
    for (const clip of timeline) {
      for (let k = 1; k <= 5; k++) {
        const seconds = (clip.start + (clip.duration * k) / 6) / 30
        const diff = pictureDifference(await rgbFrame(remotion, seconds), await rgbFrame(own, seconds), 1920, 1080)
        expect(diff.mean, `mean difference at ${seconds.toFixed(2)} s`).toBeLessThanOrEqual(3)
        expect(diff.worstOutsideEdges, `worst difference at ${seconds.toFixed(2)} s`).toBeLessThanOrEqual(48)
      }
    }
  })

  it('sounds the same: as loud, and quiet in the same places', async () => {
    const { remotion, own } = results.get(name)!
    expect(Math.abs((await integratedLoudness(own)) - (await integratedLoudness(remotion)))).toBeLessThanOrEqual(0.5)
    const theirs = await silences(remotion)
    const ours = await silences(own)
    expect(ours.length).toBe(theirs.length)
    ours.forEach((gap, i) => {
      expect(Math.abs(gap.start - theirs[i].start)).toBeLessThanOrEqual(2 * FRAME)
      if (Number.isFinite(gap.end) && Number.isFinite(theirs[i].end)) expect(Math.abs(gap.end - theirs[i].end)).toBeLessThanOrEqual(2 * FRAME)
    })
  })
})

describe('speed', () => {
  it(`exports ${SPEED_FIXTURE} in at most 1.2 times Remotion’s time`, () => {
    const { remotionSeconds, ownSeconds } = results.get(SPEED_FIXTURE)!
    expect(ownSeconds).toBeLessThanOrEqual(remotionSeconds * 1.2)
  })
})
```

`listProjects(baseDir)` returns summaries with `id` and `name`. The installer names the examples as above. Check against `ProjectSummary` before running.

The speed comparison is fair only if Remotion's export runs second as often as first. The suite runs Remotion first on purpose, so any warm-cache advantage goes to Remotion, not to ours.

- [ ] **Step 3: Choose the export quality**

1. Run `npm run compare:renderer` once with `EXPORT_QUALITY = '65'`. Read the logged byte sizes.
2. Adjust `EXPORT_QUALITY` and re-run until both fixtures' own exports are within 10% of Remotion's size. VideoToolbox's `-q:v` runs 1–100, higher meaning better and larger.
3. Record the chosen value and the measured sizes in `EXPORT_QUALITY`'s comment, replacing "Provisional…". For example: "`-q:v 58` brings the shipped examples within 10% of Remotion's export sizes (walkthrough 21.3 MB vs 20.1 MB; explainer 9.8 vs 9.4), measured on 2026-10-13."
4. In the spec's §2 encoder bullet, replace "the `-q:v` that brings … chosen and recorded in step 3" with the value and the same measurement.

- [ ] **Step 4: Run the comparison until it passes, honestly**

Run: `npm run compare:renderer`

Expected: every test passes. If one fails, record its numbers in the report and fix the cause in the exporter or the engine. Likely causes:
- **Mean difference:** colour conversion, a frame off by one in `frameSource`, or the page background.
- **Silences:** the lead-in, or a take not cut at its clip's end.
- **Speed:** tab count, or JPEG quality.

Never change a limit. If a cause cannot be found, stop and report BLOCKED with the measurements.

- [ ] **Step 5: Commit**

```bash
git add vitest.compare.config.ts tsconfig.node.json package.json src/main/render/exporter/compare src/main/media/encoders.ts docs/superpowers/specs/2026-10-13-own-renderer-design.md
git commit -m "$(cat <<'EOF'
Hold Talkie's export to Remotion's on the shipped examples, and set its quality

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Documents, and every gate

**Files:**
- Modify: `AGENTS.md`, the spec (a step 3 status note)

- [ ] **Step 1: AGENTS.md**

Under "Things that will bite you", replace the bullet "**Export renders in Chrome's headless shell, not a full Chrome.**" with:

```markdown
- **Export draws in Chrome's headless shell, several tabs at once, and Talkie's ffmpeg encodes.**
  `src/main/render/exporter/` opens `tabCount()` tabs on the export page (`src/video/exportPage/`,
  built by `scripts/bundleExportPage.mjs` into `out/export-page/`, unpacked from the archive like
  the HTML scene runtime), seeks each through its run of frames and pipes CDP screenshots into an
  ffmpeg per tab; segments are joined without re-encoding and the soundtrack is mixed from the
  timeline (`soundtrack.ts`). A full Chrome holds some frames for 300–750 ms whatever the scene;
  the shell does not — `browserExecutablePath()` finds it. Recordings are drawn from frames the
  asset server decodes (`?frame=` on the video's own URL, `frameSource.ts`): the shell cannot
  decode H.264, and seeking a `<video>` frame by frame hung on Playwright's VP8. A hold past its
  timeout (30 s, as Remotion's) fails the export naming what it waited for. An export's browser
  and ffmpegs are its own processes; cancelling — including quitting mid-export, which cancels
  and waits (`exportJob.ts`) — closes them all. Remotion's export is kept behind
  `TALKIE_RENDERER=remotion` until step 5, and `npm run compare:renderer` holds the two together.
```

Edit the bullet that begins "**Remotion is handed a browser too**". Keep its history, and end it with: "Talkie's own exporter is handed the same browser the same way (`exportFromAnywhere.test.ts` reads both)."

In "Architecture", in the `src/video/` bullet, add this sentence: "In the export page `chooseOwnRenderer()` switches it to Talkie's own clock, holds and media (`own/`); elsewhere it still delegates to Remotion until step 4."

- [ ] **Step 2: The spec**

Under "## The five steps", append this note after the table:

```markdown
Step 3 status: Talkie's own export is the default; `npm run compare:renderer` passes on the
shipped examples (see the `EXPORT_QUALITY` comment for the sizes measured).
```

- [ ] **Step 3: Commit the documents**

```bash
git add AGENTS.md docs/superpowers/specs/2026-10-13-own-renderer-design.md
git commit -m "$(cat <<'EOF'
Describe Talkie's own export, and how it is held to Remotion's

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Every gate**

Run: `npm run typecheck && npm test && npm run e2e && npm run compare:renderer`

Expected: everything passes. The e2e export test now runs on Talkie's own exporter; it checks the length and the soundtrack.

- [ ] **Step 5: Report**

Tell the user:
- the branch is ready, stacked on #27;
- the comparison numbers: per-fixture times, sizes, worst mean difference, loudness difference;
- the chosen quality;
- that Remotion is now used only behind `TALKIE_RENDERER=remotion` and in the editor's player, which is step 4.

Do not push.
