# Transcript & TTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a developer attach narration text to a timeline item, synthesize it to real speech audio via macOS's built-in `say`, and have the linked item's duration automatically extend to fit the narration — all through a real transcript panel in the Editor.

**Architecture:** A `TranscriptSegment` (Zod-validated, matching spec §4's shape) links free text to a `timelineItemId`. A `TTSProvider` interface has one v1 implementation (`sayTtsProvider`) that shells out to macOS's `say` + `afconvert` to produce a real WAV file (not the spec's illustrative `.mp3` — see Global Constraints for why). A pure WAV-header parser computes the resulting audio's duration without any new dependency, which then updates the linked timeline item's `duration` via a new `updateTimelineItemDuration` function.

**Tech Stack:** macOS `say`/`afconvert` (both OS-builtin, no new npm dependency), on top of Plan 1's `ProjectAPI`, Plan 2's `TimelineItem` schema/registry and composition constants.

**Spec:** `docs/superpowers/specs/2026-09-06-demo-editor-design.md`

## Global Constraints

- `transcript.json` segments match spec §4's shape: `{id, text, timelineItemId, audioFile, status}`, with `status` one of `draft` | `edited` | `narrated` (spec §7).
- Narration audio is stored as `.wav`, not the spec's illustrative `.mp3`. This is a deliberate, disclosed deviation: macOS has no reliable built-in MP3 *encoder* (only playback), while `say` → AIFF → `afconvert -f WAVE -d LEI16` → WAV is two well-established, zero-dependency macOS built-ins, and WAV is natively playable by Chromium (which the preview player and the export run on) — AIFF is not. The `audioFile` field still stores just the filename, same as spec's model; only the extension differs.
- `readTranscript`/`readTimeline` used for read-modify-write (adding/updating segments or items) must stay strict — never silently drop an item, or the next write would delete it. This mirrors the exact lesson from Plan 2's final review (a lenient read must never feed a persist path) and Plan 3's `readTimeline`.
- All writes go through the existing `writeJsonAtomic`/Zod-validate pattern already established in `projectApi.ts` — no raw writes.
- No comments explaining *what* code does — only where a non-obvious constraint needs flagging.
- macOS only for v1 (spec §1) — this plan leans on that harder than prior ones, since `say`/`afconvert` are macOS-specific by construction.
- This plan develops directly on `main` — no worktree isolation (established user preference).

---

## Plan sequence context

This is **Plan 4 of the overall spec** (Plans 1-3 — project foundation, timeline/compositor, capture pipeline — merged to `main`). It covers spec §7 (transcript & TTS) with one deliberate, disclosed cut:

- **No Transcript Agent (spec §7 point 1, §8).** The spec's actual auto-drafting mechanism is an AI agent reading the action log and writing draft segments — but no agent host, `LLMProvider`, or agent-manifest system exists in any plan yet (spec §8 is entirely unbuilt). Building the agent host just to satisfy one agent's auto-draft step would be backwards — the agent host is a real subsystem of its own (a provider-agnostic tool-use loop, at least one `LLMProvider` implementation, the tool-permission model) and deserves its own plan. Spec §11 itself sequences things as "...timeline/preview → transcript editing → TTS → export, **with the Transcript Agent as the first agent** once..." — transcript editing and TTS are explicitly positioned as achievable before the agent exists. This plan builds the exact same `TranscriptSegment` data model and `addTranscriptSegment`/`updateTranscriptSegmentText` functions a future Transcript Agent will call through its `writeTranscriptSegment` tool — only the *authoring* is manual (human-typed) instead of AI-drafted. A future segment created by the agent starts life with `status: 'draft'` (already part of this plan's schema); every segment this plan's UI creates starts at `status: 'edited'`, since there's no AI-authored, untouched state to represent yet.
- **No debounced auto-re-synthesis on every keystroke.** Spec §7 point 3 offers two triggers — "on edit (debounced) *or* an explicit 'Narrate' action" — this plan implements only the explicit action. Text edits persist on blur (leaving the input), not on every keystroke.
- **No per-project pacing setting (stretch vs. hold-frame padding, spec §7 point 3).** With only the `image` kind existing in the timeline registry (Plan 2), extending an item's `duration` field *is* hold-frame behavior by construction — an image has no inherent playback speed to "stretch." The setting is meaningless until a second kind (e.g. `clip`, deferred by Plan 3) exists to actually differ. This plan always extends duration to fit; there is no setting to choose from yet.
- **No voice selection UI.** `sayTtsProvider` uses the system's default `say` voice (no `-v` flag). Spec §7 point 5 frames voice as a "project-level setting," but with only one provider and no voice list to pick from, a settings UI has nothing real to control yet — deferred until a second `TTSProvider` exists, matching the same "defer the abstraction until there's a second implementation to prove it against" reasoning already used for the `Compositor` interface (Plan 2) and property panels (Plan 2).

---

## File Structure

```
src/
  main/
    transcript/
      schema.ts                          # TranscriptSegmentSchema, type TranscriptSegment
      schema.test.ts
      narrate.ts                         # narrateSegment() orchestration
      narrate.test.ts                    # real integration test (real `say`+`afconvert`)
    tts/
      ttsProvider.ts                     # TTSProvider interface
      sayTtsProvider.ts                  # the one v1 implementation
      sayTtsProvider.test.ts             # real integration test
      wavDuration.ts                     # getWavDurationSeconds() — pure WAV header parser
      wavDuration.test.ts
    project/
      projectApi.ts                       # (modify) + readTranscript, addTranscriptSegment,
                                           #   updateTranscriptSegmentText, updateTranscriptSegmentAudio,
                                           #   updateTimelineItemDuration
      projectApi.test.ts                  # (modify)
    ipc/
      transcriptHandlers.ts               # project:transcript:read/addSegment/updateText/narrate
    index.ts                              # (modify) register transcript handlers
  preload/
    index.ts                              # (modify) + transcriptApi
    index.d.ts                            # (modify)
  renderer/src/
    api/
      projectClient.ts                    # (modify) + transcriptClient
    components/
      TranscriptPanel.tsx                 # extracted component — Editor.tsx was getting large
    screens/
      Editor.tsx                          # (modify) — real TranscriptPanel replaces the placeholder aside
```

---

### Task 1: Transcript segment schema

**Files:**
- Create: `src/main/transcript/schema.ts`
- Test: `src/main/transcript/schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `TranscriptSegmentSchema: ZodSchema`, `type TranscriptSegment = { id, text, timelineItemId, audioFile?, status: 'draft' | 'edited' | 'narrated' }` — used by Task 4 (`projectApi.ts`), Task 5 (`narrate.ts`), Task 6 (IPC/preload), Task 7 (renderer)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { TranscriptSegmentSchema } from './schema'

describe('TranscriptSegmentSchema', () => {
  it('accepts a valid segment without audioFile', () => {
    const segment = { id: 'abc123', text: 'Now we click Add to Cart', timelineItemId: 'item1', status: 'edited' }

    expect(TranscriptSegmentSchema.parse(segment)).toEqual(segment)
  })

  it('accepts a valid narrated segment with audioFile', () => {
    const segment = {
      id: 'abc123',
      text: 'The cart updates instantly',
      timelineItemId: 'item1',
      audioFile: 'abc123.wav',
      status: 'narrated'
    }

    expect(TranscriptSegmentSchema.parse(segment)).toEqual(segment)
  })

  it('rejects an invalid status', () => {
    const segment = { id: 'abc123', text: 'hello', timelineItemId: 'item1', status: 'published' }

    expect(() => TranscriptSegmentSchema.parse(segment)).toThrow()
  })

  it('rejects a missing timelineItemId', () => {
    const segment = { id: 'abc123', text: 'hello', status: 'edited' }

    expect(() => TranscriptSegmentSchema.parse(segment)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/transcript/schema.test.ts`
Expected: FAIL — `Cannot find module './schema'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from 'zod'

export const TranscriptSegmentSchema = z.object({
  id: z.string(),
  text: z.string(),
  timelineItemId: z.string(),
  audioFile: z.string().optional(),
  status: z.enum(['draft', 'edited', 'narrated'])
})

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/transcript/schema.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/transcript/schema.ts src/main/transcript/schema.test.ts
git commit -m "Add transcript segment schema"
```

---

### Task 2: WAV duration parser

**Files:**
- Create: `src/main/tts/wavDuration.ts`
- Test: `src/main/tts/wavDuration.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `getWavDurationSeconds(filePath: string): number` — used by Task 5 (`narrate.ts`)

This reads a WAV file's own RIFF header to compute duration — no external tool, no new dependency, and no dependence on any CLI's text-output format (which would be more fragile to parse than a well-specified binary header).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getWavDurationSeconds } from './wavDuration'

function makeTestWavBuffer(sampleRate: number, numSamples: number): Buffer {
  const bitsPerSample = 16
  const numChannels = 1
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = numSamples * blockAlign
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  return buffer
}

describe('getWavDurationSeconds', () => {
  let dir: string

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('computes duration for a 2-second 44.1kHz file', () => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-wav-test-'))
    const filePath = join(dir, 'test.wav')
    writeFileSync(filePath, makeTestWavBuffer(44100, 44100 * 2))

    expect(getWavDurationSeconds(filePath)).toBeCloseTo(2, 5)
  })

  it('computes duration for a 0.5-second 22050Hz file', () => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-wav-test-'))
    const filePath = join(dir, 'test.wav')
    writeFileSync(filePath, makeTestWavBuffer(22050, Math.round(22050 * 0.5)))

    expect(getWavDurationSeconds(filePath)).toBeCloseTo(0.5, 5)
  })

  it('throws a clear error for a file with no data chunk', () => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-wav-test-'))
    const filePath = join(dir, 'bad.wav')
    writeFileSync(filePath, Buffer.from('not a wav file at all'))

    expect(() => getWavDurationSeconds(filePath)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/tts/wavDuration.test.ts`
Expected: FAIL — `Cannot find module './wavDuration'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { readFileSync } from 'fs'

function findDataChunkOffset(buffer: Buffer): number {
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    if (chunkId === 'data') return offset
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  throw new Error('WAV file has no data chunk')
}

export function getWavDurationSeconds(filePath: string): number {
  const buffer = readFileSync(filePath)
  const sampleRate = buffer.readUInt32LE(24)
  const numChannels = buffer.readUInt16LE(22)
  const bitsPerSample = buffer.readUInt16LE(34)
  const dataChunkOffset = findDataChunkOffset(buffer)
  const dataSize = buffer.readUInt32LE(dataChunkOffset + 4)
  const bytesPerSample = bitsPerSample / 8
  const totalSamples = dataSize / (bytesPerSample * numChannels)
  return totalSamples / sampleRate
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/tts/wavDuration.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/tts/wavDuration.ts src/main/tts/wavDuration.test.ts
git commit -m "Add WAV duration parser"
```

---

### Task 3: `TTSProvider` and `sayTtsProvider`

**Files:**
- Create: `src/main/tts/ttsProvider.ts`
- Create: `src/main/tts/sayTtsProvider.ts`
- Test: `src/main/tts/sayTtsProvider.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface TTSProvider { synthesize(text: string, outputPath: string): Promise<void> }`
  - `sayTtsProvider: TTSProvider`
  - Used by Task 5 (`narrate.ts`)

This is a real integration test — it shells out to the actual `say` and `afconvert` binaries (both are part of every macOS install, no new dependency) and asserts on a real produced file. Expect real wall-clock time (a few seconds, since `say` genuinely synthesizes speech).

- [ ] **Step 1: Write `src/main/tts/ttsProvider.ts`**

```ts
export interface TTSProvider {
  synthesize: (text: string, outputPath: string) => Promise<void>
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { sayTtsProvider } from './sayTtsProvider'

describe('sayTtsProvider (real say + afconvert)', () => {
  let dir: string

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('synthesizes real speech to a real, non-empty WAV file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-tts-test-'))
    const outputPath = join(dir, 'segment.wav')

    await sayTtsProvider.synthesize('This is a test narration.', outputPath)

    expect(statSync(outputPath).size).toBeGreaterThan(1000)
  }, 30_000)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/tts/sayTtsProvider.test.ts`
Expected: FAIL — `Cannot find module './sayTtsProvider'`

- [ ] **Step 4: Write the implementation**

```ts
import { execFile } from 'child_process'
import { promisify } from 'util'
import { unlinkSync } from 'fs'
import type { TTSProvider } from './ttsProvider'

const execFileAsync = promisify(execFile)

export const sayTtsProvider: TTSProvider = {
  async synthesize(text: string, outputPath: string): Promise<void> {
    const aiffPath = outputPath.replace(/\.wav$/, '.aiff')

    await execFileAsync('say', ['-o', aiffPath, text])
    await execFileAsync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiffPath, outputPath])

    unlinkSync(aiffPath)
  }
}
```

If `say`'s default output format or `afconvert`'s exact flag names differ from what's shown here on the machine running this task, run `man say` and `man afconvert` (or just `say -o /tmp/test.aiff "hello"` and `afconvert -f WAVE -d LEI16 /tmp/test.aiff /tmp/test.wav` directly in a terminal) to confirm the real invocation, then adapt — both are long-standing, stable macOS command-line tools, so any mismatch is more likely a flag-name detail than a fundamentally different approach.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/tts/sayTtsProvider.test.ts`
Expected: PASS (1 test — real speech synthesis, expect several seconds)

- [ ] **Step 6: Commit**

```bash
git add src/main/tts/ttsProvider.ts src/main/tts/sayTtsProvider.ts src/main/tts/sayTtsProvider.test.ts
git commit -m "Add TTSProvider interface and sayTtsProvider"
```

---

### Task 4: Transcript & timeline-duration persistence functions

**Files:**
- Modify: `src/main/project/projectApi.ts`
- Modify: `src/main/project/projectApi.test.ts`

**Interfaces:**
- Consumes: `TranscriptSegmentSchema`, `type TranscriptSegment` (Task 1), `TimelineItemSchema`, `type TimelineItem` (Plan 2), `findProjectDir`, `writeJsonAtomic` (Plan 1)
- Produces:
  - `readTranscript(id: string, baseDir?: string): TranscriptSegment[]`
  - `addTranscriptSegment(id: string, input: { text: string; timelineItemId: string }, baseDir?: string): TranscriptSegment`
  - `updateTranscriptSegmentText(id: string, segmentId: string, text: string, baseDir?: string): TranscriptSegment`
  - `updateTranscriptSegmentAudio(id: string, segmentId: string, audioFile: string, baseDir?: string): TranscriptSegment`
  - `updateTimelineItemDuration(id: string, timelineItemId: string, duration: number, baseDir?: string): TimelineItem`
  - Used by Task 5 (`narrate.ts`), Task 6 (IPC handlers)

**Read this before writing `readTranscript`:** `projectApi.ts`'s existing `readTimeline` (Plan 2/3) flattens a Zod parse error into a plain `Error` via `err.issues.map(...).join('; ')` specifically because `ZodError.message` is JSON-stringified with escaped quotes (discovered the hard way in Plan 2 — a regex checking for a literal `"` character doesn't match the escaped `\"` in that string). Follow the exact same pattern in `readTranscript` for consistency and to avoid re-discovering the same bug.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/project/projectApi.test.ts` (fold `readTranscript, addTranscriptSegment, updateTranscriptSegmentText, updateTranscriptSegmentAudio, updateTimelineItemDuration` into the existing `import { createProject, ... } from './projectApi'` line rather than a second import statement; this file already imports `addTimelineItem`, `findProjectDir`, `mkdtempSync`, `rmSync`, `join`, `tmpdir` — reuse them):

```ts
describe('readTranscript', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('returns an empty array for a freshly created project', () => {
    const project = createProject('Empty Transcript', baseDir)

    expect(readTranscript(project.id, baseDir)).toEqual([])
  })

  it('throws when the project does not exist', () => {
    expect(() => readTranscript('does-not-exist', baseDir)).toThrow('No project found with id does-not-exist')
  })
})

describe('addTranscriptSegment', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('appends a segment with status "edited" and a generated id', () => {
    const project = createProject('Add Segment', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)

    const segment = addTranscriptSegment(project.id, { text: 'Hello', timelineItemId: item.id }, baseDir)

    expect(segment.id).toBeTruthy()
    expect(segment.text).toBe('Hello')
    expect(segment.timelineItemId).toBe(item.id)
    expect(segment.status).toBe('edited')
    expect(readTranscript(project.id, baseDir)).toEqual([segment])
  })
})

describe('updateTranscriptSegmentText', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('updates the text and resets status to "edited"', () => {
    const project = createProject('Update Text', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Original', timelineItemId: item.id }, baseDir)

    const updated = updateTranscriptSegmentText(project.id, segment.id, 'Changed', baseDir)

    expect(updated.text).toBe('Changed')
    expect(updated.status).toBe('edited')
    expect(readTranscript(project.id, baseDir)[0].text).toBe('Changed')
  })

  it('throws a clear error when the segment does not exist', () => {
    const project = createProject('Update Missing', baseDir)

    expect(() => updateTranscriptSegmentText(project.id, 'does-not-exist', 'x', baseDir)).toThrow(
      'No transcript segment found with id does-not-exist'
    )
  })
})

describe('updateTranscriptSegmentAudio', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('sets audioFile and status to "narrated"', () => {
    const project = createProject('Update Audio', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Hi', timelineItemId: item.id }, baseDir)

    const updated = updateTranscriptSegmentAudio(project.id, segment.id, `${segment.id}.wav`, baseDir)

    expect(updated.audioFile).toBe(`${segment.id}.wav`)
    expect(updated.status).toBe('narrated')
  })
})

describe('updateTimelineItemDuration', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('updates only the duration of the matching item', () => {
    const project = createProject('Update Duration', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)

    const updated = updateTimelineItemDuration(project.id, item.id, 200, baseDir)

    expect(updated.duration).toBe(200)
    expect(updated.id).toBe(item.id)
    expect(updated.start).toBe(0)
  })

  it('throws a clear error when the timeline item does not exist', () => {
    const project = createProject('Update Duration Missing', baseDir)

    expect(() => updateTimelineItemDuration(project.id, 'does-not-exist', 100, baseDir)).toThrow(
      'No timeline item found with id does-not-exist'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/project/projectApi.test.ts`
Expected: FAIL — `readTranscript is not a function`

- [ ] **Step 3: Write the implementation**

Add to `src/main/project/projectApi.ts` (add `TranscriptSegmentSchema, type TranscriptSegment` to a new import from `./transcript/schema` — note the relative path is `../transcript/schema` since `transcript/` is a sibling of `project/` under `src/main/`):

```ts
import { TranscriptSegmentSchema, type TranscriptSegment } from '../transcript/schema'

export function readTranscript(id: string, baseDir: string = homedir()): TranscriptSegment[] {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const raw = JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf-8'))
  try {
    return raw.map((segment: unknown) => TranscriptSegmentSchema.parse(segment))
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(err.issues.map((issue) => issue.message).join('; '))
    }
    throw err
  }
}

export function addTranscriptSegment(
  id: string,
  input: { text: string; timelineItemId: string },
  baseDir: string = homedir()
): TranscriptSegment {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const newSegment = TranscriptSegmentSchema.parse({
    id: randomUUID(),
    text: input.text,
    timelineItemId: input.timelineItemId,
    status: 'edited'
  })

  const transcript = readTranscript(id, baseDir)
  transcript.push(newSegment)
  writeJsonAtomic(join(dir, 'transcript.json'), transcript)
  return newSegment
}

export function updateTranscriptSegmentText(
  id: string,
  segmentId: string,
  text: string,
  baseDir: string = homedir()
): TranscriptSegment {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const transcript = readTranscript(id, baseDir)
  const index = transcript.findIndex((segment) => segment.id === segmentId)
  if (index === -1) {
    throw new Error(`No transcript segment found with id ${segmentId}`)
  }

  const updated = TranscriptSegmentSchema.parse({ ...transcript[index], text, status: 'edited' })
  transcript[index] = updated
  writeJsonAtomic(join(dir, 'transcript.json'), transcript)
  return updated
}

export function updateTranscriptSegmentAudio(
  id: string,
  segmentId: string,
  audioFile: string,
  baseDir: string = homedir()
): TranscriptSegment {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const transcript = readTranscript(id, baseDir)
  const index = transcript.findIndex((segment) => segment.id === segmentId)
  if (index === -1) {
    throw new Error(`No transcript segment found with id ${segmentId}`)
  }

  const updated = TranscriptSegmentSchema.parse({ ...transcript[index], audioFile, status: 'narrated' })
  transcript[index] = updated
  writeJsonAtomic(join(dir, 'transcript.json'), transcript)
  return updated
}

export function updateTimelineItemDuration(
  id: string,
  timelineItemId: string,
  duration: number,
  baseDir: string = homedir()
): TimelineItem {
  const dir = findProjectDir(id, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${id}`)
  }

  const timeline = readTimeline(id, baseDir)
  const index = timeline.findIndex((item) => item.id === timelineItemId)
  if (index === -1) {
    throw new Error(`No timeline item found with id ${timelineItemId}`)
  }

  const updated = TimelineItemSchema.parse({ ...timeline[index], duration })
  timeline[index] = updated
  writeJsonAtomic(join(dir, 'timeline.json'), timeline)
  return updated
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/project/projectApi.test.ts`
Expected: PASS (all tests including the 8 new ones)

Run: `npm run test`
Expected: full suite passes

- [ ] **Step 5: Commit**

```bash
git add src/main/project/projectApi.ts src/main/project/projectApi.test.ts
git commit -m "Add transcript and timeline-duration persistence functions"
```

---

### Task 5: `narrateSegment` orchestration

**Files:**
- Create: `src/main/transcript/narrate.ts`
- Test: `src/main/transcript/narrate.test.ts`

**Interfaces:**
- Consumes: `readTranscript`, `updateTranscriptSegmentAudio`, `updateTimelineItemDuration` (Task 4), `sayTtsProvider` (Task 3), `getWavDurationSeconds` (Task 2), `FPS` (Plan 2, `src/composition/constants.ts`), `findProjectDir` (Plan 1)
- Produces: `narrateSegment(projectId: string, segmentId: string, baseDir?: string): Promise<TranscriptSegment>` — used by Task 6 (IPC handler)

This is a real integration test — it runs the actual `say`/`afconvert` pipeline through `sayTtsProvider` and asserts on real files and real state changes.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject, addTimelineItem, addTranscriptSegment, readTranscript, readTimeline } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { narrateSegment } from './narrate'

describe('narrateSegment (real say + afconvert)', () => {
  it('synthesizes real audio and extends the linked timeline item to fit', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-narrate-test-'))
    const project = createProject('Narrate Test', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/tmp/a.png' } }, baseDir)
    const segment = addTranscriptSegment(
      project.id,
      { text: 'This narration is definitely longer than one second of audio.', timelineItemId: item.id },
      baseDir
    )

    const result = await narrateSegment(project.id, segment.id, baseDir)

    expect(result.status).toBe('narrated')
    expect(result.audioFile).toBe(`${segment.id}.wav`)

    const dir = findProjectDir(project.id, baseDir) as string
    const audioPath = join(dir, 'audio', result.audioFile as string)
    expect(existsSync(audioPath)).toBe(true)
    expect(statSync(audioPath).size).toBeGreaterThan(1000)

    const updatedItem = readTimeline(project.id, baseDir).find((i) => i.id === item.id)
    expect(updatedItem?.duration).toBeGreaterThan(30)

    const updatedTranscript = readTranscript(project.id, baseDir)
    expect(updatedTranscript[0].status).toBe('narrated')

    rmSync(baseDir, { recursive: true, force: true })
  }, 30_000)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/transcript/narrate.test.ts`
Expected: FAIL — `Cannot find module './narrate'`

- [ ] **Step 3: Write the implementation**

```ts
import { homedir } from 'os'
import { join } from 'path'
import { findProjectDir } from '../project/paths'
import { readTranscript, updateTranscriptSegmentAudio, updateTimelineItemDuration } from '../project/projectApi'
import { sayTtsProvider } from '../tts/sayTtsProvider'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { FPS } from '../../composition/constants'
import type { TranscriptSegment } from './schema'

export async function narrateSegment(
  projectId: string,
  segmentId: string,
  baseDir: string = homedir()
): Promise<TranscriptSegment> {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${projectId}`)
  }

  const transcript = readTranscript(projectId, baseDir)
  const segment = transcript.find((s) => s.id === segmentId)
  if (!segment) {
    throw new Error(`No transcript segment found with id ${segmentId}`)
  }

  const audioFileName = `${segmentId}.wav`
  const audioPath = join(dir, 'audio', audioFileName)
  await sayTtsProvider.synthesize(segment.text, audioPath)

  const durationSeconds = getWavDurationSeconds(audioPath)
  const durationFrames = Math.max(1, Math.round(durationSeconds * FPS))
  updateTimelineItemDuration(projectId, segment.timelineItemId, durationFrames, baseDir)

  return updateTranscriptSegmentAudio(projectId, segmentId, audioFileName, baseDir)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/transcript/narrate.test.ts`
Expected: PASS (1 test — real speech synthesis, expect several seconds)

- [ ] **Step 5: Commit**

```bash
git add src/main/transcript/narrate.ts src/main/transcript/narrate.test.ts
git commit -m "Add narrateSegment orchestration"
```

---

### Task 6: IPC handlers and preload

**Files:**
- Create: `src/main/ipc/transcriptHandlers.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Interfaces:**
- Consumes: `readTranscript`, `addTranscriptSegment`, `updateTranscriptSegmentText` (Task 4), `narrateSegment` (Task 5), `type TranscriptSegment` (Task 1)
- Produces:
  - `window.api.transcript.read(projectId): Promise<TranscriptSegment[]>`
  - `window.api.transcript.addSegment(projectId, input): Promise<TranscriptSegment>`
  - `window.api.transcript.updateText(projectId, segmentId, text): Promise<TranscriptSegment>`
  - `window.api.transcript.narrate(projectId, segmentId): Promise<TranscriptSegment>`
  - Used by Task 7 (`projectClient.ts`, `TranscriptPanel.tsx`)

This is IPC plumbing over already-tested logic — no new business logic, so verification is manual (typecheck/build), matching the established pattern from every prior plan's IPC task.

- [ ] **Step 1: Write `src/main/ipc/transcriptHandlers.ts`**

```ts
import type { IpcMain } from 'electron'
import {
  readTranscript,
  addTranscriptSegment,
  updateTranscriptSegmentText
} from '../project/projectApi'
import { narrateSegment } from '../transcript/narrate'

export function registerTranscriptHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('project:transcript:read', (_event, projectId: string) => readTranscript(projectId))

  ipcMain.handle(
    'project:transcript:addSegment',
    (_event, projectId: string, input: { text: string; timelineItemId: string }) =>
      addTranscriptSegment(projectId, input)
  )

  ipcMain.handle('project:transcript:updateText', (_event, projectId: string, segmentId: string, text: string) =>
    updateTranscriptSegmentText(projectId, segmentId, text)
  )

  ipcMain.handle('project:transcript:narrate', (_event, projectId: string, segmentId: string) =>
    narrateSegment(projectId, segmentId)
  )
}
```

- [ ] **Step 2: Wire it into `src/main/index.ts`**

Add the import:

```ts
import { registerTranscriptHandlers } from './ipc/transcriptHandlers'
```

Inside `app.whenReady().then(() => { ... })`, alongside the existing handler registrations:

```ts
registerTranscriptHandlers(ipcMain)
```

- [ ] **Step 3: Extend `src/preload/index.ts`**

Add to the existing file:

```ts
import type { TranscriptSegment } from '../main/transcript/schema'

const transcriptApi = {
  read: (projectId: string): Promise<TranscriptSegment[]> => ipcRenderer.invoke('project:transcript:read', projectId),
  addSegment: (
    projectId: string,
    input: { text: string; timelineItemId: string }
  ): Promise<TranscriptSegment> => ipcRenderer.invoke('project:transcript:addSegment', projectId, input),
  updateText: (projectId: string, segmentId: string, text: string): Promise<TranscriptSegment> =>
    ipcRenderer.invoke('project:transcript:updateText', projectId, segmentId, text),
  narrate: (projectId: string, segmentId: string): Promise<TranscriptSegment> =>
    ipcRenderer.invoke('project:transcript:narrate', projectId, segmentId)
}

// Change the exposeInMainWorld call to include: transcript: transcriptApi

export type TranscriptApi = typeof transcriptApi
```

- [ ] **Step 4: Extend `src/preload/index.d.ts`**

```ts
import type { ProjectApi, TimelineApi, RenderApi, CaptureApi, TranscriptApi } from './index'

declare global {
  interface Window {
    api: {
      project: ProjectApi
      timeline: TimelineApi
      render: RenderApi
      capture: CaptureApi
      transcript: TranscriptApi
    }
  }
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: exits 0

Run: `npm run build`
Expected: exits 0

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/transcriptHandlers.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "Add transcript IPC handlers and preload API"
```

---

### Task 7: Transcript panel in the Editor

**Files:**
- Modify: `src/renderer/src/api/projectClient.ts`
- Create: `src/renderer/src/components/TranscriptPanel.tsx`
- Modify: `src/renderer/src/screens/Editor.tsx`

**Interfaces:**
- Consumes: `window.api.transcript.*` (Task 6), `type TimelineItem` (already imported in `Editor.tsx`)
- Produces: `TranscriptPanel({ projectId, timeline }: { projectId: string; timeline: TimelineItem[] })` component

`Editor.tsx` has grown across three plans; extracting the transcript UI into its own component keeps it from growing further and matches the "smaller, focused files" principle — same reasoning that already applies to `DemoComposition`/`ImageItem` living outside `Editor.tsx`.

- [ ] **Step 1: Add `transcriptClient` to `projectClient.ts`**

Add to `src/renderer/src/api/projectClient.ts` (following the exact type-only cross-boundary import pattern already used for `TimelineItem` in this file — do not redeclare a duplicate interface):

```ts
import type { TranscriptSegment } from '../../../main/transcript/schema'

export type { TranscriptSegment }

export const transcriptClient = {
  read: (projectId: string): Promise<TranscriptSegment[]> => window.api.transcript.read(projectId),
  addSegment: (
    projectId: string,
    input: { text: string; timelineItemId: string }
  ): Promise<TranscriptSegment> => window.api.transcript.addSegment(projectId, input),
  updateText: (projectId: string, segmentId: string, text: string): Promise<TranscriptSegment> =>
    window.api.transcript.updateText(projectId, segmentId, text),
  narrate: (projectId: string, segmentId: string): Promise<TranscriptSegment> =>
    window.api.transcript.narrate(projectId, segmentId)
}
```

- [ ] **Step 2: Write `src/renderer/src/components/TranscriptPanel.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { transcriptClient, type TranscriptSegment } from '../api/projectClient'
import type { TimelineItem } from '../api/projectClient'

export function TranscriptPanel({
  projectId,
  timeline
}: {
  projectId: string
  timeline: TimelineItem[]
}): JSX.Element {
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [newText, setNewText] = useState('')
  const [newItemId, setNewItemId] = useState('')
  const [narratingId, setNarratingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    transcriptClient.read(projectId).then(setSegments)
  }, [projectId])

  async function handleAdd(): Promise<void> {
    if (!newText.trim() || !newItemId) return
    setError(null)
    try {
      await transcriptClient.addSegment(projectId, { text: newText.trim(), timelineItemId: newItemId })
      setNewText('')
      setSegments(await transcriptClient.read(projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleLocalTextChange(segmentId: string, text: string): void {
    setSegments((prev) => prev.map((s) => (s.id === segmentId ? { ...s, text } : s)))
  }

  async function handleTextBlur(segmentId: string, text: string): Promise<void> {
    setError(null)
    try {
      await transcriptClient.updateText(projectId, segmentId, text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleNarrate(segmentId: string): Promise<void> {
    setNarratingId(segmentId)
    setError(null)
    try {
      const updated = await transcriptClient.narrate(projectId, segmentId)
      setSegments((prev) => prev.map((s) => (s.id === segmentId ? updated : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setNarratingId(null)
    }
  }

  return (
    <div>
      <p>Transcript</p>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {segments.map((segment) => (
        <div key={segment.id}>
          <textarea
            value={segment.text}
            onChange={(e) => handleLocalTextChange(segment.id, e.target.value)}
            onBlur={(e) => handleTextBlur(segment.id, e.target.value)}
          />
          <span>{segment.status}</span>
          <button onClick={() => handleNarrate(segment.id)} disabled={narratingId === segment.id}>
            {narratingId === segment.id ? 'Narrating…' : 'Narrate'}
          </button>
        </div>
      ))}
      <div>
        <select value={newItemId} onChange={(e) => setNewItemId(e.target.value)}>
          <option value="">Select timeline item…</option>
          {timeline.map((item) => (
            <option key={item.id} value={item.id}>
              {item.kind} ({item.id.slice(0, 8)})
            </option>
          ))}
        </select>
        <textarea value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="New segment text" />
        <button onClick={handleAdd}>Add Segment</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire it into `Editor.tsx`**

Add the import:

```tsx
import { TranscriptPanel } from '../components/TranscriptPanel'
```

Replace the line `<aside>Transcript</aside>` with:

```tsx
<aside>
  <TranscriptPanel projectId={projectId} timeline={timeline} />
</aside>
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: exits 0

Run: `npm run build`
Expected: exits 0

Run: `npm run test`
Expected: full suite passes (no new tests in this task, UI-only)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/api/projectClient.ts src/renderer/src/components/TranscriptPanel.tsx src/renderer/src/screens/Editor.tsx
git commit -m "Add transcript panel to the Editor"
```

---

### Task 8: Full plan verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `npm run test`
Expected: PASS — every suite from Plans 1-3 plus this plan's new ones. Three real, non-mocked integration tests now exist for speech synthesis alone (`sayTtsProvider.test.ts`, `narrate.test.ts`) on top of Plan 2/3's real render/capture tests — expect the full run to take noticeably longer than any single prior plan's suite. That's expected, not a regression.

- [ ] **Step 2: Run the full typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0

- [ ] **Step 3: Real end-to-end proof via script**

Create a throwaway script (do not commit it) proving the full chain: create a project, add a timeline item, add a transcript segment, narrate it, and confirm the linked item's duration actually changed.

```ts
// scratch-e2e.ts — run with: npx tsx scratch-e2e.ts
import { createProject, addTimelineItem, addTranscriptSegment, readTimeline } from './src/main/project/projectApi'
import { narrateSegment } from './src/main/transcript/narrate'
import { writeFileSync } from 'fs'

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function main(): Promise<void> {
  const project = createProject('E2E Transcript Test')
  const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/tmp/pixel.png' } })
  writeFileSync('/tmp/pixel.png', Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'))

  console.log('Original duration (frames):', item.duration)

  const segment = addTranscriptSegment(project.id, {
    text: 'This is a real narration long enough to noticeably extend the clip.',
    timelineItemId: item.id
  })

  const narrated = await narrateSegment(project.id, segment.id)
  console.log('Narrated segment:', narrated)

  const updatedItem = readTimeline(project.id).find((i) => i.id === item.id)
  console.log('New duration (frames):', updatedItem?.duration)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

Run it with `npx tsx scratch-e2e.ts` (or whatever TypeScript runner is available — `tsx` was already used for Plan 2's equivalent script). Expected: prints the original duration, the narrated segment (with `status: 'narrated'` and a real `audioFile`), and a new duration strictly greater than the original.

- [ ] **Step 4: Clean up**

```bash
rm scratch-e2e.ts /tmp/pixel.png
ls ~/DemoStudio/Projects  # find the "e2e-transcript-test" directory
rm -rf ~/DemoStudio/Projects/*-e2e-transcript-test
```

- [ ] **Step 5: Final commit** (only if any of the above required fixes)

```bash
git add -A
git commit -m "Fix issues found in Plan 4 full verification"
```

If nothing needed fixing, there is nothing to commit — Plan 4 is complete.
