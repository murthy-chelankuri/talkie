# Own renderer, step 1 — the seam: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The composition and the editor reach Remotion only through a new module, `src/video/`, so steps 3 and 4 can replace Remotion's insides without touching a scene again. Nothing a person sees changes.

**Architecture:** `src/video/` has two entry points. `src/video/index.ts` is what the composition (`src/remotion/`) imports: the frame clock, holds, media and motion. `src/video/preview.tsx` is what the editor imports: a `<Preview>` with the same handle as Remotion's `<Player>`. In this step every piece delegates to Remotion, with two exceptions: `spring` and `interpolate` are our own, because they are pure functions that can be proved equal now, while Remotion is still here to compare against. A boundary test then holds every other file to the seam.

**Tech Stack:** React 18, TypeScript 5.5, Remotion 4.0.522, vitest 2 (node by default, jsdom by docblock), electron-vite.

**Spec:** `docs/superpowers/specs/2026-10-13-own-renderer-design.md` — §1 and the "five steps" table, step 1.

## Global Constraints

- Work in the worktree `/Users/murthy/Documents/Github/talkie-renderer`, branch `feature/own-renderer`. `node_modules` there is a symlink to `../talkie/node_modules`. It shows as untracked and **must never be committed**, so stage files by name and never `git add -A` or `git add .`.
- Behaviour unchanged: same scenes, same motion, same preview controls, same export. Every PR passes `npm test`, `npm run typecheck` and `npm run e2e`.
- Nothing in this step may be specific to macOS.
- British spelling in names and user-facing text (colour, licence). Comments say *why*, usually the failure that shaped the code. Do not narrate the code.
- Tests describe behaviour. Their names read as sentences about what the software does.
- Commit messages are plain sentences in the repository's style ("Rename the launch example's made-up app from Lumen to Tidewell"), ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The pre-commit hook runs the types and related tests. Do not use `--no-verify`.
- Never read, copy or grep `~/Talkie/settings.json`; it holds API keys.
- Do not push or open a PR. The user asks for that separately.

## Decisions this plan makes that the spec left open

- **`hold` returns its own `release`.** The call is `const release = hold(label, { timeoutMs })`, then `release()`. Release is idempotent. `LogoMark` already releases twice (on load and on unmount), and a second release must do nothing.
- **`Fill`** replaces Remotion's `AbsoluteFill`. Five scenes use `AbsoluteFill`, and the spec's table missed it.
- **Two entry points, not one.** If the composition imported a barrel that also exported `<Preview>`, `@remotion/player` would end up in the export bundle.
- **Remotion's bundler entry moves**, from `src/remotion/index.tsx` to `src/video/remotionEntry.tsx`. It is Remotion glue, not a scene. Step 3 replaces it with the export page and `<VideoRoot>`.
- **The main process's `@remotion/renderer` and `@remotion/bundler` imports stay.** They are steps 2 and 3. In this step the guard confines them to `src/main/`, `scripts/` and `src/video/`, so they cannot spread; steps 2 and 3 tighten it. Task 6 amends the spec's step-1 row to match.
- **`<Preview>` keeps `controls`, `loop` and `autoPlay`.** The HTML-scene panel and the theme preview use all three. The spec's §4 says Talkie uses no looping, which is wrong. Task 6 corrects §4, so step 4 knows to build them.

## How Remotion's spring behaves (measured, so ours can match it)

These were measured against `remotion@4.0.522` while planning. They are behaviour, written down so the implementation does not depend on reading Remotion's source:

1. Position follows a damped harmonic oscillator from 0 to 1, starting at rest: natural frequency ω₀ = √(stiffness / mass), damping ratio ζ = damping / (2√(stiffness·mass)).
2. **Any ζ ≥ 1 moves as critically damped:** 1 − e^(−ω₀t)(1 + ω₀t). `damping` 20, 21, 50 and 200 give identical curves. Talkie's springs all use `damping: 200`.
3. Below critical damping, the usual closed form applies: 1 − e^(−ζω₀t)(cos ω_d t + (ζω₀/ω_d) sin ω_d t), with ω_d = ω₀√(1 − ζ²).
4. `frame <= 0` gives 0.
5. With `durationInFrames`:
   - time is rescaled by `naturalFrames / durationInFrames`;
   - `naturalFrames` is one past the last whole frame at which |1 − x| ≥ 0.005, giving 23 for `{ damping: 200 }` and 28 for the defaults at 30 fps;
   - a frame **strictly greater than** `durationInFrames` gives exactly 1.
6. `overshootClamping` caps the value at 1.
7. The defaults are mass 1, stiffness 100, damping 10, no clamping.

A prototype built on these rules matched Remotion to within 4.4 × 10⁻¹⁶ over:
- frames −3 to 60 in quarter frames;
- the four durations Talkie uses (12, 14, 16 and 18 frames);
- underdamped, clamped, heavier and stiffer configurations.

## File structure

| File | Responsibility |
|---|---|
| `src/video/motion.ts` (create) | `spring`, `interpolate`: our own and pure |
| `src/video/motion.test.ts` (create) | Ours against sampled Remotion values, plus `interpolate`'s rules |
| `src/video/springSamples.json` (create) | Remotion's spring, sampled once; kept after Remotion goes |
| `src/video/clock.tsx` (create) | `useFrame`, `useVideoConfig`, `useRenderMode`, `Sequence`, `Fill` |
| `src/video/hold.ts` (create) | `hold` → `release` |
| `src/video/hold.test.ts` (create) | Labels, timeouts, idempotent release |
| `src/video/media.tsx` (create) | `Picture`, `Footage`, `Sound` |
| `src/video/index.ts` (create) | What the composition may import |
| `src/video/preview.tsx` (create) | `<Preview>`, `PreviewHandle`: what the editor may import |
| `src/video/preview.test.tsx` (create) | The handle and events delegate to the player |
| `src/video/remotionEntry.tsx` (move from `src/remotion/index.tsx`) | Remotion's bundler entry, until step 3 |
| `src/video/videoBoundary.test.ts` (create) | Nothing else imports Remotion |
| `src/remotion/**` (modify) | Imports from `../video` and uses its names |
| `src/renderer/src/screens/Editor.tsx`, `components/{TransportBar,Timeline,ScriptView}.tsx`, `components/htmlScene/HtmlScenePanel.tsx`, `components/themes/ThemePreview.tsx` (modify) | `Preview`/`PreviewHandle` instead of `Player`/`PlayerRef` |
| `tsconfig.web.json`, `vitest.config.ts` (modify) | Include `src/video` |
| `scripts/bundleRemotion.mjs`, `src/main/render/renderProject.ts`, `src/main/render/composition.test.ts` (modify) | Point at the moved entry |
| `AGENTS.md`, the spec (modify) | Say what `src/video/` is; correct step 1's row and §4 |

---

### Task 1: Our own `spring` and `interpolate`

**Files:**
- Create: `src/video/motion.ts`, `src/video/motion.test.ts`, `src/video/springSamples.json`
- Modify: `vitest.config.ts` (include list), `tsconfig.web.json` (include list)

**Interfaces:**
- Produces:
  - `spring(options: { frame: number; fps: number; config?: Partial<SpringConfig>; durationInFrames?: number }): number`
  - `type SpringConfig = { mass: number; stiffness: number; damping: number; overshootClamping: boolean }`
  - `interpolate(value: number, input: readonly number[], output: readonly number[], options?: { extrapolateLeft?: Extrapolate; extrapolateRight?: Extrapolate }): number`
  - `type Extrapolate = 'clamp' | 'extend'`

- [ ] **Step 1: Let vitest and the web tsconfig see `src/video`**

In `vitest.config.ts`, add `'src/video/**/*.test.{ts,tsx}',` to `test.include` after the `src/remotion` line. In `tsconfig.web.json`, add `"src/video/**/*"` to `include` after `"src/remotion/**/*"`.

- [ ] **Step 2: Sample Remotion's spring once, into test data**

Write this to `.sample-spring.mjs` at the worktree root. It must run from there so that `remotion` resolves.

```js
import { writeFileSync } from 'node:fs'
import { spring } from 'remotion'

// The configurations Talkie uses (damping 200 over 12–18 frames), then one of each other regime
// so ours is held to Remotion's whole behaviour, not only the corner Talkie lives in today.
const cases = [
  { fps: 30, config: { damping: 200 }, durationInFrames: 12 },
  { fps: 30, config: { damping: 200 }, durationInFrames: 14 },
  { fps: 30, config: { damping: 200 }, durationInFrames: 16 },
  { fps: 30, config: { damping: 200 }, durationInFrames: 18 },
  { fps: 30, config: { damping: 200 } },
  { fps: 30, config: {} },
  { fps: 30, config: {}, durationInFrames: 30 },
  { fps: 30, config: { damping: 5, overshootClamping: true } },
  { fps: 30, config: { mass: 2, damping: 200 }, durationInFrames: 16 },
  { fps: 30, config: { stiffness: 300, damping: 12 }, durationInFrames: 20 },
  { fps: 60, config: { damping: 200 }, durationInFrames: 24 }
]
const samples = cases.map((c) => {
  const frames = []
  for (let frame = -3; frame <= 40; frame += 0.5) frames.push([frame, spring({ frame, ...c })])
  return { ...c, frames }
})
writeFileSync('src/video/springSamples.json', JSON.stringify(samples) + '\n')
```

Run: `node .sample-spring.mjs && rm .sample-spring.mjs && head -c 300 src/video/springSamples.json`

Expected: JSON that starts `[{"fps":30,"config":{"damping":200},"durationInFrames":12,"frames":[[-3,0],`.

- [ ] **Step 3: Write the failing tests**

`src/video/motion.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { interpolate, spring, type SpringConfig } from './motion'
import samples from './springSamples.json'

/**
 * Remotion's spring, sampled from remotion@4.0.522 while both were installed. Kept as data so
 * the motion of every slide can still be checked against what it was once Remotion is gone.
 */
type Sample = { fps: number; config: Partial<SpringConfig>; durationInFrames?: number; frames: [number, number][] }

describe('a spring', () => {
  for (const sample of samples as Sample[]) {
    it(`moves as Remotion's did for ${JSON.stringify(sample.config)} at ${sample.fps} fps over ${sample.durationInFrames ?? 'its own'} frames`, () => {
      for (const [frame, expected] of sample.frames) {
        expect(spring({ frame, fps: sample.fps, config: sample.config, durationInFrames: sample.durationInFrames })).toBeCloseTo(expected, 9)
      }
    })
  }

  it('has not started before its first frame', () => {
    expect(spring({ frame: -5, fps: 30, config: { damping: 200 } })).toBe(0)
  })

  it('is exactly at rest once its duration has passed', () => {
    expect(spring({ frame: 13, fps: 30, config: { damping: 200 }, durationInFrames: 12 })).toBe(1)
  })
})

describe('interpolate', () => {
  it('maps a value across a range in a straight line', () => {
    expect(interpolate(0.5, [0, 1], [10, 0])).toBe(5)
  })

  it('follows each segment of a range with several stops', () => {
    expect(interpolate(15, [0, 10, 20], [0, 100, 0])).toBe(50)
  })

  it('carries on past either end unless told to clamp, as Remotion did', () => {
    expect(interpolate(2, [0, 1], [0, 10])).toBe(20)
    expect(interpolate(-1, [0, 1], [0, 10])).toBe(-10)
  })

  it('stops at the ends when clamped', () => {
    expect(interpolate(2, [0, 1], [0, 10], { extrapolateRight: 'clamp' })).toBe(10)
    expect(interpolate(-1, [0, 1], [0, 10], { extrapolateLeft: 'clamp' })).toBe(0)
  })

  it('refuses ranges it cannot follow, rather than drawing something wrong', () => {
    expect(() => interpolate(0, [0, 1], [0, 1, 2])).toThrow()
    expect(() => interpolate(0, [0], [0])).toThrow()
    expect(() => interpolate(0, [1, 0], [0, 1])).toThrow()
  })
})
```

- [ ] **Step 4: Run them to see them fail**

Run: `npx vitest run src/video/motion.test.ts`

Expected: FAIL, "Failed to resolve import ./motion".

- [ ] **Step 5: Write `src/video/motion.ts`**

```ts
/**
 * The motion every scene is drawn with. Our own, written from the physics and from how
 * Remotion's was measured to behave (see the plan for step 1), so that slides move exactly as
 * they did once Remotion is gone; springSamples.json holds the proof.
 */

export type SpringConfig = { mass: number; stiffness: number; damping: number; overshootClamping: boolean }

const DEFAULT_SPRING: SpringConfig = { mass: 1, stiffness: 100, damping: 10, overshootClamping: false }

/** How close to rest counts as settled, when a spring is fitted into a number of frames. */
const SETTLED = 0.005

/** How far from 0 towards 1 the spring has travelled after this long, starting at rest. */
function position(seconds: number, { mass, stiffness, damping }: SpringConfig): number {
  const natural = Math.sqrt(stiffness / mass)
  const ratio = damping / (2 * Math.sqrt(stiffness * mass))
  // Anything at or past critical damping moves as critically damped. That is what Remotion's did,
  // and every slide Talkie draws uses damping 200, deep in that range.
  if (ratio >= 1) return 1 - Math.exp(-natural * seconds) * (1 + natural * seconds)
  const damped = natural * Math.sqrt(1 - ratio * ratio)
  return 1 - Math.exp(-ratio * natural * seconds) * (Math.cos(damped * seconds) + ((ratio * natural) / damped) * Math.sin(damped * seconds))
}

/** No spring can be further from rest than this after this long, so the search can stop. */
function bound(seconds: number, { mass, stiffness, damping }: SpringConfig): number {
  const natural = Math.sqrt(stiffness / mass)
  const ratio = damping / (2 * Math.sqrt(stiffness * mass))
  if (ratio >= 1) return Math.exp(-natural * seconds) * (1 + natural * seconds)
  const damped = natural * Math.sqrt(1 - ratio * ratio)
  return Math.exp(-ratio * natural * seconds) * Math.sqrt(1 + ((ratio * natural) / damped) ** 2)
}

const settledAt = new Map<string, number>()

/** One past the last whole frame at which the spring is still visibly moving. */
function naturalFrames(fps: number, config: SpringConfig): number {
  const key = `${fps}:${config.mass}:${config.stiffness}:${config.damping}`
  const known = settledAt.get(key)
  if (known !== undefined) return known
  let last = 0
  for (let frame = 0; bound(frame / fps, config) >= SETTLED; frame++) {
    if (Math.abs(1 - position(frame / fps, config)) >= SETTLED) last = frame + 1
  }
  settledAt.set(key, last)
  return last
}

export function spring({
  frame,
  fps,
  config = {},
  durationInFrames
}: {
  frame: number
  fps: number
  config?: Partial<SpringConfig>
  /** Fits the spring's movement into this many frames, however long it would naturally take. */
  durationInFrames?: number
}): number {
  const settings = { ...DEFAULT_SPRING, ...config }
  if (frame <= 0) return 0
  let at = frame
  if (durationInFrames !== undefined) {
    if (frame > durationInFrames) return 1
    at = (frame * naturalFrames(fps, settings)) / durationInFrames
  }
  const value = position(at / fps, settings)
  return settings.overshootClamping ? Math.min(value, 1) : value
}

export type Extrapolate = 'clamp' | 'extend'

export function interpolate(
  value: number,
  input: readonly number[],
  output: readonly number[],
  { extrapolateLeft = 'extend', extrapolateRight = 'extend' }: { extrapolateLeft?: Extrapolate; extrapolateRight?: Extrapolate } = {}
): number {
  // A mismatched range would draw something plausible and wrong, which is worse than an error.
  if (input.length !== output.length) throw new Error(`interpolate needs ranges of one length, not ${input.length} and ${output.length}`)
  if (input.length < 2) throw new Error('interpolate needs at least two points')
  for (let i = 1; i < input.length; i++) {
    if (!(input[i] > input[i - 1])) throw new Error(`interpolate needs a strictly increasing input range, not [${input.join(', ')}]`)
  }

  const last = input.length - 1
  if (value < input[0] && extrapolateLeft === 'clamp') return output[0]
  if (value > input[last] && extrapolateRight === 'clamp') return output[last]

  let segment = 0
  while (segment < last - 1 && value >= input[segment + 1]) segment++
  const progress = (value - input[segment]) / (input[segment + 1] - input[segment])
  return output[segment] + progress * (output[segment + 1] - output[segment])
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run src/video/motion.test.ts`

Expected: PASS, 18 tests (11 samples, 2 spring rules, 5 interpolate).
- If a spring sample fails, the cause is a rule in "How Remotion's spring behaves". Do not loosen `toBeCloseTo(…, 9)`.
- If the JSON import fails to type-check, `resolveJsonModule` is already on in both tsconfigs, so check the path.

- [ ] **Step 7: Type-check and commit**

Run: `npm run typecheck`. Expected: no errors.

```bash
git add vitest.config.ts tsconfig.web.json src/video/motion.ts src/video/motion.test.ts src/video/springSamples.json
git commit -m "$(cat <<'EOF'
Draw springs and ranges with Talkie's own motion, matched to Remotion's

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The clock, holds and media, delegating to Remotion

**Files:**
- Create: `src/video/clock.tsx`, `src/video/hold.ts`, `src/video/hold.test.ts`, `src/video/media.tsx`, `src/video/index.ts`

**Interfaces:**
- Consumes: `spring`, `interpolate`, `SpringConfig` and `Extrapolate` from `./motion` (Task 1).
- Produces, all from `src/video/index.ts`:
  - `useFrame(): number`
  - `useVideoConfig(): VideoConfig`, where `type VideoConfig = { fps: number; width: number; height: number; durationInFrames: number }`
  - `useRenderMode(): RenderMode`, where `type RenderMode = 'export' | 'preview'`
  - `Sequence(props: { from: number; durationInFrames?: number; children: ReactNode })`
  - `Fill(props: { style?: CSSProperties; children?: ReactNode })`
  - `hold(label: string, options?: { timeoutMs?: number }): Release`, where `type Release = () => void`
  - `Picture(props: { src: string; alt?: string; style?: CSSProperties })`
  - `Footage(props: { src: string; trimBefore?: number; trimAfter?: number; style?: CSSProperties })`
  - `Sound(props: { src: string })`
  - `spring`, `interpolate`, and their types, re-exported

- [ ] **Step 1: Write the failing test for holds**

`src/video/hold.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const delayRender = vi.fn((_label?: string, _options?: object) => 7)
const continueRender = vi.fn((_handle: number) => undefined)
vi.mock('remotion', () => ({ delayRender, continueRender }))

const { hold } = await import('./hold')

beforeEach(() => {
  delayRender.mockClear()
  continueRender.mockClear()
})

describe('a hold', () => {
  it('keeps the frame from being taken, under the label an export failure would name', () => {
    hold('Loading the theme’s fonts')

    expect(delayRender).toHaveBeenCalledWith('Loading the theme’s fonts', undefined)
  })

  it('passes on how long it may be held', () => {
    hold('Fetching diagram', { timeoutMs: 30_000 })

    expect(delayRender).toHaveBeenCalledWith('Fetching diagram', { timeoutInMilliseconds: 30_000 })
  })

  it('lets the frame go once, however many times it is released', () => {
    // LogoMark releases when the colours arrive and again when it unmounts.
    const release = hold('Reading the logo’s colours')
    release()
    release()

    expect(continueRender).toHaveBeenCalledTimes(1)
    expect(continueRender).toHaveBeenCalledWith(7)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/video/hold.test.ts`

Expected: FAIL, "Failed to resolve import ./hold".

- [ ] **Step 3: Write `src/video/hold.ts`**

```ts
import { continueRender, delayRender } from 'remotion'

export type Release = () => void

/**
 * Keeps the current frame from being taken until what it needs has arrived: a font, a diagram,
 * a logo's colours, an HTML scene's drawing. The label is what an export that times out names.
 *
 * Delegates to Remotion until step 3 of the renderer brings Talkie's own export.
 */
export function hold(label: string, { timeoutMs }: { timeoutMs?: number } = {}): Release {
  const handle = delayRender(label, timeoutMs === undefined ? undefined : { timeoutInMilliseconds: timeoutMs })
  let released = false
  // Idempotent because releasing on success and again on unmount is the natural way to write a
  // hold that must never be left open, and a second release must not let go of someone else's.
  return () => {
    if (released) return
    released = true
    continueRender(handle)
  }
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/video/hold.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Write `src/video/clock.tsx`**

```tsx
import type { CSSProperties, ReactNode } from 'react'
import {
  AbsoluteFill,
  Sequence as RemotionSequence,
  getRemotionEnvironment,
  useCurrentFrame,
  useVideoConfig as useRemotionVideoConfig
} from 'remotion'

/**
 * The frame clock the composition is drawn against. The host (the editor's preview or the
 * export) owns the frame; scenes only read it.
 *
 * Delegates to Remotion until steps 3 and 4 of the renderer replace it; the names here are the
 * ones the scenes keep.
 */

export type VideoConfig = { fps: number; width: number; height: number; durationInFrames: number }
export type RenderMode = 'export' | 'preview'

/** The frame, counted from the start of the nearest enclosing Sequence. */
export function useFrame(): number {
  return useCurrentFrame()
}

/** The video's size and rate, and the enclosing Sequence's length. */
export function useVideoConfig(): VideoConfig {
  const { fps, width, height, durationInFrames } = useRemotionVideoConfig()
  return { fps, width, height, durationInFrames }
}

/** Whether frames are being exported, which waits on holds, or previewed, which never does. */
export function useRenderMode(): RenderMode {
  return getRemotionEnvironment().isRendering ? 'export' : 'preview'
}

/** Shifts the clock for its children, and mounts them only while the frame is inside it. */
export function Sequence({ from, durationInFrames, children }: { from: number; durationInFrames?: number; children: ReactNode }): JSX.Element {
  return (
    <RemotionSequence from={from} durationInFrames={durationInFrames}>
      {children}
    </RemotionSequence>
  )
}

/** A layer covering the whole frame. */
export function Fill({ style, children }: { style?: CSSProperties; children?: ReactNode }): JSX.Element {
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>
}
```

- [ ] **Step 6: Write `src/video/media.tsx`**

```tsx
import type { CSSProperties } from 'react'
import { Audio, Img, OffthreadVideo } from 'remotion'

/**
 * Pictures, footage and sound, each held until it can be shown at the frame asked for.
 * Every `src` must already be an http URL from the asset server: the export page is served
 * over http, and Chromium will not load file:// beneath it (see resolveTimelineAssetUrls).
 *
 * Delegates to Remotion until steps 3 and 4 of the renderer.
 */

export function Picture({ src, alt, style }: { src: string; alt?: string; style?: CSSProperties }): JSX.Element {
  return <Img src={src} alt={alt} style={style} />
}

/**
 * A recording, from `trimBefore` up to `trimAfter` (frames into the file).
 *
 * OffthreadVideo, not Video: an HTML5 <video> seeked frame by frame hangs on the VP8 .webm
 * files Playwright produces, so the export takes frames from the compositor instead. In the
 * preview it plays as an ordinary video.
 */
export function Footage({
  src,
  trimBefore,
  trimAfter,
  style
}: {
  src: string
  trimBefore?: number
  trimAfter?: number
  style?: CSSProperties
}): JSX.Element {
  return <OffthreadVideo src={src} trimBefore={trimBefore} trimAfter={trimAfter} style={style} />
}

/** Narration, starting at the enclosing Sequence's first frame. */
export function Sound({ src }: { src: string }): JSX.Element {
  return <Audio src={src} />
}
```

- [ ] **Step 7: Write `src/video/index.ts`**

```ts
/**
 * Everything the composition may use for time and media. Nothing else in Talkie imports
 * Remotion (videoBoundary.test.ts), so replacing Remotion is a change to this folder and not to
 * every scene. The editor's player is the other way in: ./preview, kept apart so the export
 * bundle does not carry a player it never uses.
 */
export { useFrame, useVideoConfig, useRenderMode, Sequence, Fill, type VideoConfig, type RenderMode } from './clock'
export { hold, type Release } from './hold'
export { Picture, Footage, Sound } from './media'
export { spring, interpolate, type SpringConfig, type Extrapolate } from './motion'
```

- [ ] **Step 8: Type-check and commit**

Run: `npm run typecheck && npx vitest run src/video`

Expected: no type errors; motion and hold pass.

```bash
git add src/video/clock.tsx src/video/hold.ts src/video/hold.test.ts src/video/media.tsx src/video/index.ts
git commit -m "$(cat <<'EOF'
Give the composition one way in to its clock, holds and media

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The composition through the seam

**Files:**
- Modify:
  - `src/remotion/CaptionOverlay.tsx`, `DemoComposition.tsx`, `DemoComposition.test.ts`, `LogoMark.tsx`, `LogoOverlay.tsx`, `ThemeFonts.tsx`
  - `src/remotion/items/{DiagramScene,HtmlScene,ImageItem,TextScene,VideoItem}.tsx`
  - `src/remotion/htmlScene.test.tsx`, `src/remotion/themedComposition.test.tsx`

**Interfaces:**
- Consumes: everything listed for `src/video/index.ts` in Task 2.
- Produces: nothing new. The composition's own exports are unchanged.

The tests come first, because they mock the module the scenes are about to import. Once they mock `../video`, they fail until the scenes move.

- [ ] **Step 1: Point the two scene tests' mocks at the seam**

In `src/remotion/htmlScene.test.tsx`, replace the `vi.mock('remotion', …)` block with:

```tsx
vi.mock('../video', () => ({
  Fill: ({ children, style }: { children?: ReactNode; style?: object }) => <div style={style}>{children}</div>,
  useFrame: () => 0,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 90 }),
  useRenderMode: () => 'preview',
  hold: () => () => undefined
}))
```

In `src/remotion/themedComposition.test.tsx`, change the comment above the mock to `// The scenes' clock wants a player around it; the frame it would report is all these need.`. Then replace the `vi.mock('remotion', …)` block with:

```tsx
vi.mock('../video', () => ({
  Fill: ({ children, style }: { children?: ReactNode; style?: object }) => <div style={style}>{children}</div>,
  Picture: (props: Record<string, unknown>) => <img {...props} />,
  useFrame: () => 60,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080 }),
  spring: () => 1,
  interpolate: (_v: number, _i: number[], out: number[]) => out[out.length - 1],
  hold: () => () => undefined
}))
```

In `src/remotion/DemoComposition.test.ts`, change `import { Sequence } from 'remotion'` to `import { Sequence } from '../video'`. Then change the docblock's first sentence to `The composition's clock needs a player context to render, so rather than rendering this asserts on`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/remotion`

Expected: FAIL. The scenes still import `remotion`, which is no longer mocked, so `useCurrentFrame` throws outside a player, and `DemoComposition.test.ts` finds no `Sequence`.

- [ ] **Step 3: Move each composition file to the seam**

Change only imports and names. The behaviour and the JSX structure stay as they are.

- `CaptionOverlay.tsx`: `import { useCurrentFrame } from 'remotion'` becomes `import { useFrame } from '../video'`; `useCurrentFrame()` becomes `useFrame()`.
- `LogoOverlay.tsx`: `import { useVideoConfig } from '../video'`.
- `DemoComposition.tsx`: `import { Sequence, Sound } from '../video'`; `<Audio src={audioUrl} />` becomes `<Sound src={audioUrl} />`.
- `ThemeFonts.tsx`: `import { hold } from '../video'`. In the docblock, "Held with delayRender because" becomes "Held because". Then the body:

```tsx
  const [release] = useState(() => (css ? hold('Loading the theme’s fonts') : null))

  useEffect(() => {
    if (release === null) return
    const families = [theme.fonts.heading, theme.fonts.body].filter((font) => font.urls.length > 0)
    Promise.all(families.map((font) => document.fonts.load(`1em "${font.family.replace(/"/g, '')}"`)))
      .catch(() => undefined)
      .finally(release)
  }, [release, theme])
```

- `LogoMark.tsx`: `import { Picture, hold } from '../video'`; `<Img` becomes `<Picture`. The effect becomes:

```tsx
  useEffect(() => {
    if (!background) return
    let wanted = true
    const release = hold('Reading the logo’s colours')
    void readLogoColours(url).then((read) => {
      if (wanted) setColours(read)
      release()
    })
    return () => {
      wanted = false
      release()
    }
  }, [url, background])
```

- `items/ImageItem.tsx`: `import { Picture } from '../../video'`; `<Img` becomes `<Picture`. In the comment, "Remotion's headless Chromium cannot load file:// subresources from the http://localhost page it serves compositions from" becomes "the export's headless Chromium cannot load file:// subresources from the http page the composition is served from".
- `items/VideoItem.tsx`: `import { Footage, useFrame } from '../../video'`; `useCurrentFrame()` becomes `useFrame()`; `<OffthreadVideo` becomes `<Footage`. Delete the comment paragraph that begins "OffthreadVideo, not Video:"; that reason now lives on `Footage` in `src/video/media.tsx`. Keep the `trimBefore`/`trimAfter` paragraph. In the first comment, "since Remotion serves compositions from an http://localhost page" becomes "since the composition is served from an http page".
- `items/TextScene.tsx`: `import { Fill, interpolate, spring, useFrame, useVideoConfig } from '../../video'`; `useCurrentFrame()` becomes `useFrame()`; `<AbsoluteFill` and `</AbsoluteFill>` become `<Fill` and `</Fill>`.
- `items/DiagramScene.tsx`: the import block becomes `import { Fill, hold, interpolate, spring, useFrame, useVideoConfig } from '../../video'`; `useCurrentFrame()` becomes `useFrame()`; `AbsoluteFill` becomes `Fill`. In the fetch effect, `const handle = delayRender(\`Fetching diagram ${src}\`)` becomes `const release = hold(\`Fetching diagram ${src}\`)`, and `.finally(() => continueRender(handle))` becomes `.finally(release)`.
- `items/HtmlScene.tsx`: `import { Fill, hold, useFrame, useRenderMode, useVideoConfig, type Release } from '../../video'`. Then:
  - `useCurrentFrame()` becomes `useFrame()`.
  - `const rendering = getRemotionEnvironment().isRendering` becomes `const rendering = useRenderMode() === 'export'`.
  - `const [loadHandle] = useState(() => (rendering ? delayRender(\`Loading the HTML scene "${scene.title}"\`) : null))` becomes `const [releaseLoad] = useState<Release | null>(() => (rendering ? hold(\`Loading the HTML scene "${scene.title}"\`) : null))`.
  - `settle` becomes `const settle = (): void => releaseLoad?.()`.
  - In the per-frame effect, `const handle = rendering ? delayRender(…) : null` becomes `const release = rendering ? hold(\`HTML scene "${scene.title}", frame ${frame}\`) : null`, and both `if (handle !== null) continueRender(handle)` become `release?.()`.
  - `AbsoluteFill` becomes `Fill`.
  - In `confineFrames`'s docblock, "the export renders this composition in a page of Remotion's, which has none" becomes "the export renders this composition in a page with no such policy".

- [ ] **Step 4: Check nothing in the composition still names Remotion's API**

Run: `grep -rnE "from 'remotion'|delayRender|continueRender|useCurrentFrame|AbsoluteFill|OffthreadVideo|getRemotionEnvironment|<Img|<Audio" src/remotion --include='*.ts' --include='*.tsx' | grep -v "^src/remotion/index.tsx"`

Expected: no output. `src/remotion/index.tsx` is Task 4's.

- [ ] **Step 5: Run the composition tests and the types**

Run: `npx vitest run src/remotion src/video && npm run typecheck`

Expected: PASS, no type errors.

- [ ] **Step 6: Watch one slide and one diagram move as before**

Run: `npx vitest run src/main/render/composition.test.ts src/main/render/themedExport.test.ts src/main/render/htmlSceneExport.test.ts`

Expected: PASS. These bundle the composition through Remotion and render it, so a broken hold or clock shows up here as a timeout.

- [ ] **Step 7: Commit**

```bash
git add src/remotion
git commit -m "$(cat <<'EOF'
Draw every scene through src/video rather than Remotion directly

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Remotion's bundler entry moves into the seam

**Files:**
- Move: `src/remotion/index.tsx` → `src/video/remotionEntry.tsx`
- Modify: `scripts/bundleRemotion.mjs:4,22`, `src/main/render/renderProject.ts:88`, `src/main/render/composition.test.ts:77`

**Interfaces:**
- Consumes: `DemoComposition` from `src/remotion/DemoComposition.tsx`; `FPS`, `WIDTH`, `HEIGHT`, `COMPOSITION_ID` from `src/remotion/constants.ts`.
- Produces: a Remotion bundle entry at `src/video/remotionEntry.tsx`. The bundle's output in `out/remotion/` is unchanged.

- [ ] **Step 1: Move the file**

Run: `git mv src/remotion/index.tsx src/video/remotionEntry.tsx`

Then change its two local imports to `'../remotion/DemoComposition'` and `'../remotion/constants'`, and put this docblock above `function RemotionRoot`:

```tsx
/**
 * The entry Remotion's bundler builds the composition from, for export.
 *
 * Here rather than beside the scenes because it is Remotion's and nothing else's. Step 3 of the
 * renderer replaces it with Talkie's own export page.
 */
```

- [ ] **Step 2: Point everything that names the entry at its new place**

- `scripts/bundleRemotion.mjs`: `const ENTRY = join(root, 'src/video/remotionEntry.tsx')`. In the docblock, the historical mention of `src/remotion/index.tsx` stays; it describes the old bug.
- `src/main/render/renderProject.ts:88`: `remotionBundleLocation(join(__dirname, '../../video/remotionEntry.tsx'))`.
- `src/main/render/composition.test.ts:77`: `bundle({ entryPoint: join(process.cwd(), 'src/video/remotionEntry.tsx') })`.

Run: `grep -rn "remotion/index" src scripts e2e examples/build`

Expected: only the explanatory comments in `scripts/bundleRemotion.mjs` and `src/main/render/remotionBundle.ts`.

- [ ] **Step 3: Build the bundle and render through it**

Run: `npm run build:remotion && ls out/remotion/index.html && npx vitest run src/main/render/composition.test.ts src/main/render/renderProject.test.ts`

Expected: "Bundled the composition for rendering", the file exists, tests PASS. Then `npx vitest run src/main/render/remotionBundle.test.ts src/main/render/exportFromAnywhere.test.ts` — the second exports from `/`, which is where a wrong entry path shows.

- [ ] **Step 4: Commit**

```bash
git add src/video/remotionEntry.tsx scripts/bundleRemotion.mjs src/main/render/renderProject.ts src/main/render/composition.test.ts
git commit -m "$(cat <<'EOF'
Keep Remotion's bundler entry inside src/video with the rest of Remotion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `<Preview>` for the editor

**Files:**
- Create: `src/video/preview.tsx`, `src/video/preview.test.tsx`
- Modify:
  - `src/renderer/src/screens/Editor.tsx:2,130,971-980`
  - `src/renderer/src/components/TransportBar.tsx:2,16`, `src/renderer/src/components/Timeline.tsx:10,432`, `src/renderer/src/components/ScriptView.tsx:2,60,169`
  - `src/renderer/src/components/htmlScene/HtmlScenePanel.tsx:2,313`, `src/renderer/src/components/themes/ThemePreview.tsx:2,61`
  - `src/renderer/src/components/htmlScene/htmlScene.test.tsx:8`

**Interfaces:**
- Produces, from `src/video/preview.tsx`:
  - `Preview`: `<P extends object>(props: PreviewProps<P> & { ref?: Ref<PreviewHandle> }) => JSX.Element`, where `PreviewProps<P> = { component: ComponentType<P>; inputProps: P; durationInFrames: number; fps: number; width: number; height: number; controls?: boolean; loop?: boolean; autoPlay?: boolean; style?: CSSProperties }`
  - `type PreviewEvents = { frameupdate: { frame: number }; play: undefined; pause: undefined }`
  - `interface PreviewHandle`:
    - `seekTo(frame: number): void`, `getCurrentFrame(): number`, `toggle(): void`, `isPlaying(): boolean`
    - `mute(): void`, `unmute(): void`, `isMuted(): boolean`, `requestFullscreen(): void`
    - `addEventListener<E extends keyof PreviewEvents>(event: E, listener: (event: { detail: PreviewEvents[E] }) => void): void`
    - `removeEventListener`, with the same signature as `addEventListener`

- [ ] **Step 1: Write the failing test**

`src/video/preview.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { render } from '@testing-library/react'

/** Stands in for Remotion's player and records what was asked of it. */
const calls: unknown[][] = []
const fakePlayer = {
  seekTo: (frame: number) => calls.push(['seekTo', frame]),
  getCurrentFrame: () => 42,
  toggle: () => calls.push(['toggle']),
  isPlaying: () => true,
  mute: () => calls.push(['mute']),
  unmute: () => calls.push(['unmute']),
  isMuted: () => false,
  requestFullscreen: () => calls.push(['requestFullscreen']),
  addEventListener: (event: string, listener: unknown) => calls.push(['add', event, listener]),
  removeEventListener: (event: string, listener: unknown) => calls.push(['remove', event, listener])
}
vi.mock('@remotion/player', () => ({
  Player: forwardRef(function Player(props: { controls?: boolean; loop?: boolean }, ref) {
    useImperativeHandle(ref, () => fakePlayer)
    return <div data-testid="player" data-controls={String(!!props.controls)} data-loop={String(!!props.loop)} />
  })
}))

const { Preview } = await import('./preview')
type Handle = import('./preview').PreviewHandle

function mount(extra: { controls?: boolean; loop?: boolean } = {}) {
  const ref = createRef<Handle>()
  const view = render(
    <Preview ref={ref} component={() => null} inputProps={{}} durationInFrames={90} fps={30} width={1920} height={1080} {...extra} />
  )
  return { ref, view }
}

describe('the preview', () => {
  it('answers the transport, timeline and script as the player did', () => {
    const { ref } = mount()
    ref.current!.seekTo(12)
    ref.current!.toggle()
    ref.current!.mute()
    ref.current!.unmute()
    ref.current!.requestFullscreen()

    expect(ref.current!.getCurrentFrame()).toBe(42)
    expect(ref.current!.isPlaying()).toBe(true)
    expect(ref.current!.isMuted()).toBe(false)
    expect(calls).toEqual(expect.arrayContaining([['seekTo', 12], ['toggle'], ['mute'], ['unmute'], ['requestFullscreen']]))
  })

  it('tells listeners about frames, play and pause, and stops when they leave', () => {
    const { ref } = mount()
    const onFrame = (_event: { detail: { frame: number } }): void => undefined
    ref.current!.addEventListener('frameupdate', onFrame)
    ref.current!.removeEventListener('frameupdate', onFrame)

    expect(calls).toEqual(expect.arrayContaining([['add', 'frameupdate', onFrame], ['remove', 'frameupdate', onFrame]]))
  })

  it('shows its own controls and loops where a panel asks for that', () => {
    const { view } = mount({ controls: true, loop: true })

    expect(view.getByTestId('player').dataset).toMatchObject({ controls: 'true', loop: 'true' })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/video/preview.test.tsx`

Expected: FAIL, "Failed to resolve import ./preview".

- [ ] **Step 3: Write `src/video/preview.tsx`**

```tsx
import { forwardRef, useImperativeHandle, useRef, type ComponentType, type CSSProperties, type ForwardedRef, type Ref } from 'react'
import { Player, type PlayerRef } from '@remotion/player'

/**
 * The editor's player: the stage, the HTML scene panel and the theme preview. Its handle and
 * events are exactly what the transport bar, the timeline and the script already use, so that
 * when step 4 of the renderer replaces what is inside, none of them change.
 */

export type PreviewEvents = { frameupdate: { frame: number }; play: undefined; pause: undefined }
type Listener<E extends keyof PreviewEvents> = (event: { detail: PreviewEvents[E] }) => void

export interface PreviewHandle {
  seekTo(frame: number): void
  getCurrentFrame(): number
  toggle(): void
  isPlaying(): boolean
  mute(): void
  unmute(): void
  isMuted(): boolean
  requestFullscreen(): void
  addEventListener<E extends keyof PreviewEvents>(event: E, listener: Listener<E>): void
  removeEventListener<E extends keyof PreviewEvents>(event: E, listener: Listener<E>): void
}

export type PreviewProps<P extends object> = {
  component: ComponentType<P>
  inputProps: P
  durationInFrames: number
  fps: number
  width: number
  height: number
  /** The player's own controls, for panels without the editor's transport bar. */
  controls?: boolean
  loop?: boolean
  autoPlay?: boolean
  style?: CSSProperties
}

function PreviewWith<P extends object>(
  { component, inputProps, durationInFrames, fps, width, height, controls, loop, autoPlay, style }: PreviewProps<P>,
  ref: ForwardedRef<PreviewHandle>
): JSX.Element {
  const player = useRef<PlayerRef>(null)

  // Delegates call by call rather than handing out Remotion's own handle, so the editor cannot
  // come to rely on anything the replacement will not have.
  useImperativeHandle(
    ref,
    () => ({
      seekTo: (frame) => player.current?.seekTo(frame),
      getCurrentFrame: () => player.current?.getCurrentFrame() ?? 0,
      toggle: () => player.current?.toggle(),
      isPlaying: () => player.current?.isPlaying() ?? false,
      mute: () => player.current?.mute(),
      unmute: () => player.current?.unmute(),
      isMuted: () => player.current?.isMuted() ?? false,
      requestFullscreen: () => player.current?.requestFullscreen(),
      // Remotion's emitter is typed per event; ours are the same names and payloads.
      addEventListener: (event, listener) => player.current?.addEventListener(event, listener as never),
      removeEventListener: (event, listener) => player.current?.removeEventListener(event, listener as never)
    }),
    []
  )

  return (
    <Player
      ref={player}
      // Remotion types its props as a string-keyed record; ours are the composition's own type.
      component={component as unknown as ComponentType<Record<string, unknown>>}
      inputProps={inputProps as unknown as Record<string, unknown>}
      durationInFrames={durationInFrames}
      fps={fps}
      compositionWidth={width}
      compositionHeight={height}
      controls={controls}
      loop={loop}
      autoPlay={autoPlay}
      style={style}
    />
  )
}

export const Preview = forwardRef(PreviewWith) as <P extends object>(
  props: PreviewProps<P> & { ref?: Ref<PreviewHandle> }
) => JSX.Element
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/video/preview.test.tsx`

Expected: PASS, 3 tests.

- [ ] **Step 5: Move the editor onto it**

- `Editor.tsx`:
  - `import { Preview, type PreviewHandle } from '../../../video/preview'` replaces the `@remotion/player` import.
  - `useRef<PlayerRef>(null)` becomes `useRef<PreviewHandle>(null)`.
  - The `<Player …>` at line 971 becomes:

```tsx
                  <Preview
                    ref={playerRef}
                    component={DemoComposition}
                    inputProps={{ timeline: remotionTimeline, theme: renderTheme ?? null }}
                    durationInFrames={computeTimelineDuration(remotionTimeline)}
                    fps={FPS}
                    width={WIDTH}
                    height={HEIGHT}
                    style={{ width: '100%', height: '100%' }}
                  />
```

- `TransportBar.tsx`, `Timeline.tsx` and `ScriptView.tsx`: `import type { PreviewHandle } from '../../../video/preview'` replaces `import type { PlayerRef } from '@remotion/player'`, and every `PlayerRef` becomes `PreviewHandle`. The prop stays named `playerRef`, since the call sites already use that name.
- `HtmlScenePanel.tsx`: `import { Preview } from '../../../../video/preview'`. `<Player` becomes `<Preview`, `compositionWidth` becomes `width` and `compositionHeight` becomes `height`; `controls` and `loop` stay.
- `ThemePreview.tsx`: the same import, at `'../../../../video/preview'`. Make the same three changes; `controls`, `loop` and `autoPlay` stay.
- `htmlScene.test.tsx:8`: `vi.mock('../../../../video/preview', () => ({ Preview: () => <div data-testid="player" /> }))`.
- Comments in `TransportBar.tsx:29` and `Timeline.tsx:474` that say "the Player" stay. They describe the player, which is still a player.

Run: `grep -rn "@remotion" src/renderer`

Expected: no output.

- [ ] **Step 6: Run the renderer tests and the types**

Run: `npm run typecheck && npx vitest run src/renderer src/video`

Expected: no type errors; PASS.

- [ ] **Step 7: Watch the editor play**

Run: `npm run build && npx vitest run -c vitest.e2e.config.ts e2e/examples.e2e.ts`

Expected: PASS. It opens Meet Talkie and requires the clock to move off 0:00 after Play, which goes through the new handle.

- [ ] **Step 8: Commit**

```bash
git add src/video/preview.tsx src/video/preview.test.tsx src/renderer/src/screens/Editor.tsx src/renderer/src/components/TransportBar.tsx src/renderer/src/components/Timeline.tsx src/renderer/src/components/ScriptView.tsx src/renderer/src/components/htmlScene/HtmlScenePanel.tsx src/renderer/src/components/themes/ThemePreview.tsx src/renderer/src/components/htmlScene/htmlScene.test.tsx
git commit -m "$(cat <<'EOF'
Play the editor's preview through src/video's own handle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The boundary, and the documents that describe it

**Files:**
- Create: `src/video/videoBoundary.test.ts`
- Modify: `AGENTS.md` (Architecture section), `docs/superpowers/specs/2026-10-13-own-renderer-design.md` (the step-1 row; §4's "Not included")

**Interfaces:**
- Consumes: the finished seam from Tasks 2–5.
- Produces: the guard that steps 2 and 3 tighten by shrinking `MAIN_PROCESS_ONLY`'s allowed places.

- [ ] **Step 1: Write the guard**

`src/video/videoBoundary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

/**
 * Remotion is reached through src/video and nowhere else.
 *
 * Talkie is replacing Remotion (docs/superpowers/specs/2026-10-13-own-renderer-design.md), and
 * that is only a change to one folder while every scene and every editor component goes through
 * it. One convenient direct import works perfectly and quietly makes the replacement a hunt
 * again, so this reads the sources, tests and mocks included: a test mocking `remotion` directly
 * is testing a scene against something it no longer imports.
 *
 * The main process still exports and measures with @remotion/renderer and @remotion/bundler; steps 2
 * and 3 replace those, and narrow MAIN_PROCESS_ONLY's places as they go.
 */
const ROOT = join(__dirname, '..', '..')
const SEAM = join('src', 'video') + sep
const SCANNED = ['src', 'scripts', 'e2e', join('examples', 'build')]

/** Export and ffmpeg, still Remotion's until steps 2 and 3, and kept to where they are used. */
const MAIN_PROCESS_ONLY = ['@remotion/renderer', '@remotion/bundler']
const MAIN_PROCESS_PLACES = [SEAM, join('src', 'main') + sep, join('scripts') + sep]

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.(ts|tsx|mjs)$/.test(entry)) found.push(path)
  }
  return found
}

function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|vi\.mock\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1])
}

const isRemotion = (specifier: string): boolean => specifier === 'remotion' || specifier.startsWith('@remotion/')

describe('the line around Remotion', () => {
  it('finds src/video importing Remotion, so a regex that matched nothing cannot pass', () => {
    expect(specifiers(readFileSync(join(ROOT, 'src', 'video', 'clock.tsx'), 'utf-8'))).toContain('remotion')
    expect(specifiers(readFileSync(join(ROOT, 'src', 'video', 'preview.tsx'), 'utf-8'))).toContain('@remotion/player')
  })

  it('lets nothing outside src/video import or mock Remotion', () => {
    const offenders = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .map((file) => relative(ROOT, file))
      .filter((file) => !file.startsWith(SEAM))
      .flatMap((file) =>
        specifiers(readFileSync(join(ROOT, file), 'utf-8'))
          .filter(isRemotion)
          .filter((specifier) => !(MAIN_PROCESS_ONLY.includes(specifier) && MAIN_PROCESS_PLACES.some((place) => file.startsWith(place))))
          .map((specifier) => `${file} imports ${specifier}`)
      )

    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/video/videoBoundary.test.ts`

Expected: PASS, 2 tests. If it lists offenders, move each one through the seam the way Task 3 or Task 5 did. Do not widen `MAIN_PROCESS_PLACES`.

- [ ] **Step 3: Prove it catches one**

Temporarily add `import { Img } from 'remotion'` as the first line of `src/remotion/items/ImageItem.tsx`.

Run: `npx vitest run src/video/videoBoundary.test.ts`

Expected: FAIL, naming `src/remotion/items/ImageItem.tsx imports remotion`. Then remove the line, and check with `git diff --stat src/remotion/items/ImageItem.tsx` that nothing is left.

- [ ] **Step 4: Say what `src/video/` is in AGENTS.md**

In `AGENTS.md` under `## Architecture`, replace the `src/remotion/` bullet with:

```markdown
- `src/remotion/` — the composition. Shared by the preview and the export, so what is on screen
  is what renders. It takes its clock, holds, media and motion from `src/video/` and never from
  Remotion itself.
- `src/video/` — the only way in to Remotion, which Talkie is replacing with its own renderer
  (`docs/superpowers/specs/2026-10-13-own-renderer-design.md`). `index.ts` is the composition's
  side and `preview.tsx` the editor's, kept apart so the export bundle carries no player.
  `spring` and `interpolate` are already Talkie's own, matched to Remotion's against sampled
  values. `videoBoundary.test.ts` fails on a direct import or mock of Remotion anywhere else; the
  main process keeps `@remotion/renderer` and `@remotion/bundler` until the export is replaced.
```

`CLAUDE.md` is a symlink to `AGENTS.md`, so do not edit it separately.

- [ ] **Step 5: Correct the spec where the code proved it wrong**

In `docs/superpowers/specs/2026-10-13-own-renderer-design.md`, the step-1 row's "Done when" cell becomes:

```
Nothing outside `src/video/` imports `remotion` or `@remotion/player`, and `@remotion/renderer`/`@remotion/bundler` only in `src/main/` and `scripts/` (steps 2–3 remove those); behaviour unchanged; all gates pass
```

In §4, replace `Not included: playback speed, looping — Talkie uses neither.` with:

```
`controls`, `loop` and `autoPlay` are kept: the HTML scene panel and the theme preview use the player's own controls and loop, and the theme preview starts by itself. Not included: playback speed — Talkie does not use it.
```

In §1's table, add a row after `<Sequence …>`:

```
| `<Fill style>` | `AbsoluteFill` | A layer covering the whole frame. |
```

- [ ] **Step 6: Commit**

```bash
git add src/video/videoBoundary.test.ts AGENTS.md docs/superpowers/specs/2026-10-13-own-renderer-design.md
git commit -m "$(cat <<'EOF'
Hold every import of Remotion to src/video, and describe the seam

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Every gate, as a push would run them

**Files:** none changed, unless a gate fails.

- [ ] **Step 1: The types and the whole suite**

Run: `npm run typecheck && npm test`

Expected: no type errors. Everything passes, with 26 more tests than `main`: 18 for motion, 3 for hold, 3 for preview and 2 for the boundary.

- [ ] **Step 2: A clean build, with the composition bundled from its new entry**

Run: `npm run build`

Expected: it ends with the "Remotion bundle:" line, and `out/remotion/index.html` exists.

- [ ] **Step 3: The end-to-end run**

Run: `npm run e2e`

Expected: all 11 pass, including the export (length and a soundtrack) and the examples playing. Any error logged in the window fails them. Do not filter it; it is a bug in this step.

- [ ] **Step 4: Confirm the step is done, as the spec defines it**

Run: `grep -rnE "(from |import\(|require\(|vi\.mock\()['\"](remotion|@remotion/[a-z-]+)['\"]" src scripts e2e examples/build | grep -v "^src/video/" | grep -vE "^(src/main|scripts)/.*@remotion/(renderer|bundler)"`

Expected: no output.

- [ ] **Step 5: Report**

Tell the user:
- the branch is ready for a PR;
- the test count compared with `main`;
- that `spring` and `interpolate` are already Talkie's own, and the evidence for it;
- the three spec corrections from Task 6.

Do not push or open the PR until asked.
