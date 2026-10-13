# Own renderer, step 2 — our own ffmpeg: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Talkie runs an ffmpeg and ffprobe it pins, checks and finds itself, through one module (`src/main/media/`), instead of the copies inside Remotion's compositor.

**Architecture:**
- **Fetching the binaries.** `scripts/fetchFfmpeg.mjs` downloads a pinned release of each binary for the current system into `vendor/ffmpeg/<platform>-<arch>/`, which git ignores. It checks every download against a SHA-256 written in `scripts/ffmpegBuilds.json`. It runs on `npm install` and is checked again by `npm run dev`.
- **Using them.** `src/main/media/` finds the binaries in a checkout or in a packaged build, runs them (`runFfmpeg`), measures media (`probeMedia`) and picks an H.264 encoder per system (`h264`).
- **Moving the callers.** Every caller of Remotion's `callFf`/`getVideoMetadata` moves to `src/main/media/`, and a boundary test keeps them there.
- **What stays on Remotion.** Its export (`renderMedia`) keeps using its own compositor until step 3.

**Tech Stack:**
- Node 18+ (`fetch`, `stream/promises`) and `child_process.execFile`
- `extract-zip` 2.0.1 (BSD-2-Clause), new as a devDependency
- vitest 2 and electron-builder

**Spec:** `docs/superpowers/specs/2026-10-13-own-renderer-design.md`, §2 and the step 2 row of the five-steps table.

## Global Constraints

- **Worktree.** Work in `/Users/murthy/Documents/Github/talkie-renderer`, on branch `feature/own-renderer-ffmpeg`. That branch is cut from `feature/own-renderer`, whose PR is #26. `node_modules` there is a symlink to `../talkie/node_modules`: it shows as untracked and **must never be committed**. Stage files by name; never run `git add -A` or `git add .`. The same applies to `vendor/`.
- **Behaviour unchanged.** Every recording, take, measurement and export comes out as before. Every PR passes `npm test`, `npm run typecheck` and `npm run e2e`.
- **Nothing specific to macOS** in the new code. The pinned table covers macOS and Linux on arm64 and x64. Windows is project 2: without a pinned build, it is reported plainly, never guessed at.
- **Encoders.** No source outside tests may ask for `libx264` or `libx265`; `gplEncoders.test.ts` holds this.
- **Spelling and comments.** Use British spelling in names and user-facing text. Comments say *why*, usually the failure that shaped the code. Tests describe behaviour, and their names read as sentences.
- **Commits.** Commit messages are plain sentences in the repository's style, ending with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never** use `--no-verify`, never read `~/Talkie/settings.json`, and never push or open a PR.

## What the planning check found (spec §2's first task)

The spec allowed for this outcome: "If not, fall back to a pinned ffmpeg build fetched and hash-checked by our own script, as the Kokoro model is." The plan takes that fallback, for these reasons:

- **`ffmpeg-static` 5.3.0** (FFmpeg 6.0 on macOS arm64) has every encoder and filter Talkie needs. But its macOS build is configured `--enable-nonfree`, and its own `ffmpeg -L` says *"This version of ffmpeg has nonfree parts compiled in. Therefore it is not legally redistributable."* Replacing Remotion for licensing reasons and gaining an ffmpeg that cannot be redistributed would be a step backwards.
- **`ffprobe-static` 3.1.0**: its `bin/darwin/arm64/ffprobe` does not run on Apple Silicon ("bad CPU type in executable"). The package also ships every platform's binaries, 81 MB each.
- **Martin Riedl's build server** (`ffmpeg.martin-riedl.de`) publishes release builds of ffmpeg and ffprobe for macOS and Linux, on both arm64 and amd64. The 9.0.2 release for macOS arm64 was checked:
  - GPL-3.0 (`--enable-gpl --enable-version3`), with no nonfree parts; `-L` reads as freely redistributable.
  - Statically linked: `otool -L` lists only system libraries.
  - Signed (team `KU3N25YGLU`).
  - Offers `h264_videotoolbox` and `aac`, plus `loudnorm`, `concat`, `amix`, `adelay`, `apad`, `atrim`, `ebur128` and `silencedetect`.
  - Each zip holds one binary at its root. Each publishes a `.sha256`, and all eight published checksums matched the downloaded files.
- **Windows** is not built there. `github.com/BtbN/FFmpeg-Builds` publishes GPL and LGPL Windows builds; project 2 adds its row.

## Decisions this plan makes

- **Binaries come from our pinned download, not `ffmpeg-static`/`ffprobe-static`.** The reasons are above. Task 6 amends spec §2 to match.
- **The fetch is its own script**, `scripts/fetchFfmpeg.mjs`, rather than added inside `ensureElectron.mjs`. It runs as `postinstall` and again from `npm run dev` with `--ensure`. That keeps the spec's point: `ignore-scripts` would silence `postinstall`, so `dev` checks too.
- **The `postinstall` never fails `npm install`.** Behind a proxy, a failed install would leave nothing to work with. It warns, naming the three causes, and `--ensure` (from `dev`) fails loudly with the same text.
- **Packaged builds carry the binaries as `extraResources`** at `Resources/ffmpeg/`. They are found from `__dirname` (the path up to `app.asar` or `app.asar.unpacked`), not from `process.resourcesPath`. The MCP server runs as plain node inside a packaged build and has no `resourcesPath`.
- **`runFfmpeg` adds nothing to the arguments.** It takes no `-loglevel` and no `-y`, exactly as `callFf` did, so every caller's output is unchanged. `onProgress` is left to step 3, the first caller that needs it.
- **`h264()` takes only `'intermediate'` for now.** The export row and its `-q:v` are step 3's, as the spec says.
- **`src/main/render/binaries.ts` keeps `binariesDirectory()`** for Remotion's `renderMedia`/`selectComposition` until step 3. `ffOptions()` goes.

## The pinned builds (verified while planning)

All are release 9.0.2, from `https://ffmpeg.martin-riedl.de/download/<os>/<arch>/<build>/<binary>.zip`:

| Key | Build | ffmpeg.zip sha256 | ffprobe.zip sha256 |
|---|---|---|---|
| darwin-arm64 | macos/arm64/1789931890_9.0.2 | `c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924` | `fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6` |
| darwin-x64 | macos/amd64/1789931006_9.0.2 | `7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4` | `2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd` |
| linux-x64 | linux/amd64/1789931100_9.0.2 | `fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f` | `3f428c49070be3d24ec338602b76d412e401ffcb8a5641ef0e729181a232fc32` |
| linux-arm64 | linux/arm64/1789931697_9.0.2 | `93a76ae90db5474eecdf951a729857c64f3de23567228d6a7d5e6e8e3cd1021b` | `bcbe80fb741c180083327afaf5434812e006b33cacde2016b9aeaf6936128330` |

## File structure

| File | Responsibility |
|---|---|
| `scripts/ffmpegBuilds.json` (create) | The pinned builds: URL and SHA-256 per binary, per system |
| `scripts/fetchFfmpeg.mjs` (create) | Fetch, verify, unpack into `vendor/ffmpeg/<key>/`; `--ensure` fails loudly |
| `src/main/media/ffmpegBuilds.test.ts` (create) | The table is well formed and this machine has a row |
| `src/main/media/binaries.ts` (create) | `toolPath`, `ffmpegPath`, `ffprobePath`, `packagedResources` |
| `src/main/media/run.ts` (create) | `runFfmpeg`, `runFfprobe` |
| `src/main/media/probe.ts` (create) | `probeMedia` |
| `src/main/media/encoders.ts` (create) | `h264`, `chooseH264` |
| `src/main/media/index.ts` (create) | What the rest of the app may import |
| `src/main/media/*.test.ts` (create) | Behaviour of each |
| `src/main/media/mediaBoundary.test.ts` (create) | Nothing else reaches ffmpeg |
| 7 production files, 11 test files, `e2e/export.e2e.ts`, `examples/build/tour/cutFootage.ts` (modify) | Call through `src/main/media` |
| `src/main/render/binaries.ts`, `binaries.test.ts`, `packagedBinaries.test.ts` (modify) | Only Remotion's export uses the compositor now |
| `package.json`, `.gitignore`, `electron-builder.yml` (modify) | Install, ignore, package |
| `README.md`, `NOTICE`, `scripts/generateNotices.mjs`, `AGENTS.md`, the spec (modify) | Say where ffmpeg comes from now |

---

### Task 1: Fetch the pinned ffmpeg and ffprobe on install

**Files:**
- Create: `scripts/ffmpegBuilds.json`, `scripts/fetchFfmpeg.mjs`, `src/main/media/ffmpegBuilds.test.ts`
- Modify: `package.json` (scripts `postinstall` and `dev`; devDependency `extract-zip`), `.gitignore`

**Interfaces:**
- Produces:
  - After install, `vendor/ffmpeg/<process.platform>-<process.arch>/` holds `ffmpeg`, `ffprobe` and `build.json` (`{ "version": "9.0.2", "source": "https://ffmpeg.martin-riedl.de" }`).
  - `scripts/ffmpegBuilds.json` has the shape `{ source: string, licence: string, builds: Record<string, { version: string, ffmpeg: { url, sha256 }, ffprobe: { url, sha256 } }> }`.

- [ ] **Step 1: Write the pinned table**

`scripts/ffmpegBuilds.json`:

```json
{
  "source": "https://ffmpeg.martin-riedl.de",
  "licence": "GPL-3.0-or-later",
  "builds": {
    "darwin-arm64": {
      "version": "9.0.2",
      "ffmpeg": { "url": "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip", "sha256": "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924" },
      "ffprobe": { "url": "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffprobe.zip", "sha256": "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6" }
    },
    "darwin-x64": {
      "version": "9.0.2",
      "ffmpeg": { "url": "https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip", "sha256": "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4" },
      "ffprobe": { "url": "https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffprobe.zip", "sha256": "2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd" }
    },
    "linux-x64": {
      "version": "9.0.2",
      "ffmpeg": { "url": "https://ffmpeg.martin-riedl.de/download/linux/amd64/1789931100_9.0.2/ffmpeg.zip", "sha256": "fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f" },
      "ffprobe": { "url": "https://ffmpeg.martin-riedl.de/download/linux/amd64/1789931100_9.0.2/ffprobe.zip", "sha256": "3f428c49070be3d24ec338602b76d412e401ffcb8a5641ef0e729181a232fc32" }
    },
    "linux-arm64": {
      "version": "9.0.2",
      "ffmpeg": { "url": "https://ffmpeg.martin-riedl.de/download/linux/arm64/1789931697_9.0.2/ffmpeg.zip", "sha256": "93a76ae90db5474eecdf951a729857c64f3de23567228d6a7d5e6e8e3cd1021b" },
      "ffprobe": { "url": "https://ffmpeg.martin-riedl.de/download/linux/arm64/1789931697_9.0.2/ffprobe.zip", "sha256": "bcbe80fb741c180083327afaf5434812e006b33cacde2016b9aeaf6936128330" }
    }
  }
}
```

- [ ] **Step 2: Write the failing test for the table**

`src/main/media/ffmpegBuilds.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * The ffmpeg Talkie runs is pinned: a release that changed upstream must not change what a
 * recording or an export does, or what was downloaded, without anyone choosing it.
 */
type Binary = { url: string; sha256: string }
const table = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'ffmpegBuilds.json'), 'utf-8')) as {
  source: string
  licence: string
  builds: Record<string, { version: string; ffmpeg: Binary; ffprobe: Binary }>
}

describe('the pinned ffmpeg builds', () => {
  it('pin every binary to one exact file from the one build server', () => {
    for (const [key, build] of Object.entries(table.builds)) {
      for (const binary of [build.ffmpeg, build.ffprobe]) {
        expect(binary.url, key).toMatch(new RegExp(`^${table.source}/download/(macos|linux)/(arm64|amd64)/\\d+_${build.version.replace(/\./g, '\\.')}/ff(mpeg|probe)\\.zip$`))
        expect(binary.sha256, key).toMatch(/^[0-9a-f]{64}$/)
      }
    }
  })

  it('pair each ffprobe with the ffmpeg from the same build', () => {
    for (const build of Object.values(table.builds)) {
      expect(build.ffprobe.url.replace('ffprobe.zip', '')).toBe(build.ffmpeg.url.replace('ffmpeg.zip', ''))
    }
  })

  it('cover macOS and Linux on both architectures', () => {
    expect(Object.keys(table.builds).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'])
  })

  it('are a licence Talkie can say it uses', () => {
    expect(table.licence).toBe('GPL-3.0-or-later')
  })
})
```

- [ ] **Step 3: Run it**

Run: `npx vitest run src/main/media/ffmpegBuilds.test.ts`

Expected: PASS, 4 tests. The table was written in step 1; this test guards it from now on.

- [ ] **Step 4: Add `extract-zip`, and ignore `vendor/`**

Run: `npm install --save-dev --save-exact extract-zip@2.0.1`.

`node_modules` is a symlink to the main checkout's, so this installs it there too. That is expected. Commit only `package.json` and `package-lock.json`.

In `.gitignore`, add after the `node_modules/` line:

```
# The pinned ffmpeg and ffprobe, fetched by scripts/fetchFfmpeg.mjs on install.
vendor/
```

- [ ] **Step 5: Write `scripts/fetchFfmpeg.mjs`**

```js
/**
 * Fetches the ffmpeg and ffprobe Talkie runs: a pinned release for this system, checked against
 * the SHA-256 in scripts/ffmpegBuilds.json, unpacked into vendor/ffmpeg/<platform>-<arch>/.
 *
 * Not ffmpeg-static: its macOS build is configured --enable-nonfree and says of itself that it
 * is "not legally redistributable", and ffprobe-static's Apple Silicon binary does not run. These
 * builds are GPL-3.0 with nothing nonfree in them, statically linked, and published with
 * checksums. Not shipped in the repository either: they are GPL binaries, and keeping them out
 * keeps publishing the source free of any obligation (see NOTICE).
 *
 *   node scripts/fetchFfmpeg.mjs            on `npm install`; warns and carries on if it fails
 *   node scripts/fetchFfmpeg.mjs --ensure   from `npm run dev`; fails loudly if it cannot
 *
 * Checked again from `dev` for the reason scripts/ensureElectron.mjs is: `ignore-scripts` skips
 * the postinstall that would have fetched it, silently.
 */
import { createHash } from 'node:crypto'
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import extract from 'extract-zip'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const table = JSON.parse(readFileSync(join(root, 'scripts', 'ffmpegBuilds.json'), 'utf-8'))
const key = `${process.platform}-${process.arch}`
const ensure = process.argv.includes('--ensure')
const target = join(root, 'vendor', 'ffmpeg', key)
const BINARIES = ['ffmpeg', 'ffprobe']

/** Both binaries, from the build the table names. A half-finished fetch has no build.json. */
function installed(build) {
  try {
    const stamp = JSON.parse(readFileSync(join(target, 'build.json'), 'utf-8'))
    return stamp.version === build.version && BINARIES.every((name) => existsSync(join(target, name)))
  } catch {
    return false
  }
}

/** Downloads to `to`, hashing as it goes, and keeps the file only if it is the one pinned. */
async function download({ url, sha256 }, to) {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`)
  const hash = createHash('sha256')
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (chunks) {
      for await (const chunk of chunks) {
        hash.update(chunk)
        yield chunk
      }
    },
    createWriteStream(to)
  )
  const actual = hash.digest('hex')
  if (actual !== sha256) {
    rmSync(to, { force: true })
    throw new Error(`${url} is not the file Talkie pinned (sha256 ${actual}, expected ${sha256})`)
  }
}

function fail(message) {
  const text = [
    '',
    message,
    '',
    'Exporting, recording and narration need it. The usual reasons it is missing:',
    '',
    '  1. npm is set not to run install scripts, which is what fetches it:',
    '       npm config get ignore-scripts        # must be false',
    `  2. ${table.source} could not be reached — a proxy or VPN may refuse it.`,
    '  3. An install that was interrupted.',
    '',
    'Then run:  node scripts/fetchFfmpeg.mjs --ensure',
    ''
  ].join('\n')
  if (ensure) {
    console.error(text)
    process.exit(1)
  }
  console.warn(text)
}

const build = table.builds[key]
if (!build) {
  // Windows arrives with project 2 (BtbN's builds); until then this is said, not guessed at.
  fail(`Talkie has no pinned ffmpeg for ${key} yet.`)
} else if (!installed(build)) {
  console.log(`Fetching ffmpeg ${build.version} for ${key} from ${table.source}…`)
  // Beside the target, so moving the binaries in is a rename on one disk, not a copy across two.
  const staging = join(root, 'vendor', 'ffmpeg', `.staging-${process.pid}`)
  try {
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    for (const name of BINARIES) {
      const zip = join(staging, `${name}.zip`)
      await download(build[name], zip)
      await extract(zip, { dir: staging })
      chmodSync(join(staging, name), 0o755)
    }
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    for (const name of BINARIES) renameSync(join(staging, name), join(target, name))
    // Written last: its presence is what says the fetch finished.
    writeFileSync(join(target, 'build.json'), JSON.stringify({ version: build.version, source: table.source }, null, 2) + '\n')
    console.log(`ffmpeg ${build.version} is in vendor/ffmpeg/${key}`)
  } catch (err) {
    fail(`Could not fetch ffmpeg: ${err instanceof Error ? err.message : err}`)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
```

- [ ] **Step 6: Run it and check what arrived**

Run: `node scripts/fetchFfmpeg.mjs && cat vendor/ffmpeg/$(node -p 'process.platform+"-"+process.arch')/build.json && vendor/ffmpeg/$(node -p 'process.platform+"-"+process.arch')/ffmpeg -hide_banner -L | head -2 && vendor/ffmpeg/$(node -p 'process.platform+"-"+process.arch')/ffprobe -hide_banner -version | head -1`

Expected:
- "Fetching ffmpeg 9.0.2 for darwin-arm64…"
- `build.json` with version 9.0.2
- "ffmpeg is free software; you can redistribute it…"
- "ffprobe version 9.0.2-https://www.martin-riedl.de…"

Then run it again. Expected: no output at all, because the build is already installed.

Then prove the check bites. Edit one hex digit of `darwin-arm64.ffmpeg.sha256` in a scratch copy:
`cp scripts/ffmpegBuilds.json /tmp/b.json && sed -i '' 's/c8ed4c4e/c8ed4c4f/' scripts/ffmpegBuilds.json && rm -rf vendor/ffmpeg && node scripts/fetchFfmpeg.mjs --ensure; echo "exit $?"; cp /tmp/b.json scripts/ffmpegBuilds.json && node scripts/fetchFfmpeg.mjs`

Expected:
- the first run prints "is not the file Talkie pinned" and `exit 1`;
- the restore puts the table back;
- the last command fetches cleanly.

Then run `git diff scripts/ffmpegBuilds.json`. Expected: no output.

- [ ] **Step 7: Run it on install and before `dev`**

In `package.json` `scripts`, add `"postinstall": "node scripts/fetchFfmpeg.mjs",` immediately after `"prepare"`. Change `"dev"` to:

```json
"dev": "node scripts/ensureElectron.mjs && node scripts/fetchFfmpeg.mjs --ensure && electron-vite dev",
```

Run: `npm run postinstall`. Expected: no output, because the build is already installed.

- [ ] **Step 8: Commit**

```bash
git add scripts/ffmpegBuilds.json scripts/fetchFfmpeg.mjs src/main/media/ffmpegBuilds.test.ts package.json package-lock.json .gitignore
git commit -m "$(cat <<'EOF'
Fetch a pinned, checked ffmpeg and ffprobe for this system on install

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `src/main/media/`, the one way to ffmpeg

**Files:**
- Create: `src/main/media/binaries.ts`, `run.ts`, `probe.ts`, `encoders.ts`, `index.ts`
- Create: `src/main/media/binaries.test.ts`, `run.test.ts`, `probe.test.ts`, `encoders.test.ts`

**Interfaces:**
- Consumes: the `vendor/ffmpeg/<key>/` from Task 1.
- Produces, from `src/main/media/index.ts`:
  - `type MediaTool = 'ffmpeg' | 'ffprobe'`
  - `toolPath(tool: MediaTool, fromDir?: string): string`, `ffmpegPath(fromDir?: string): string`, `ffprobePath(fromDir?: string): string`
  - `packagedResources(fromDir: string): string | null`
  - `type ToolOutput = { stdout: string; stderr: string }`
  - `runFfmpeg(args: string[], options?: { signal?: AbortSignal }): Promise<ToolOutput>`
  - `runFfprobe`, with the same signature as `runFfmpeg`
  - `type MediaInfo = { durationSeconds: number | null; width: number | null; height: number | null; fps: number | null; videoCodec: string | null; hasAudio: boolean }`
  - `probeMedia(path: string): Promise<MediaInfo>`
  - `type EncodePurpose = 'intermediate'`
  - `h264(purpose: EncodePurpose): Promise<string[]>`, returning `['-c:v', <encoder>, ...its quality args]`
  - `chooseH264(platform: NodeJS.Platform, offered: ReadonlySet<string>, purpose: EncodePurpose): string[]`

- [ ] **Step 1: Write the failing tests**

`src/main/media/binaries.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ffmpegPath, ffprobePath, packagedResources, toolPath } from './binaries'

const KEY = `${process.platform}-${process.arch}`
let scratch: string | null = null
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
  scratch = null
})

describe('finding ffmpeg', () => {
  it('finds the copy a packaged build carries beside its archive, from inside or outside it', () => {
    const resources = join('/Applications', 'Talkie.app', 'Contents', 'Resources')

    expect(toolPath('ffmpeg', join(resources, 'app.asar', 'out', 'main'))).toBe(join(resources, 'ffmpeg', 'ffmpeg'))
    // The MCP server runs as plain node from the unpacked copy, where there is no resourcesPath.
    expect(toolPath('ffprobe', join(resources, 'app.asar.unpacked', 'out', 'mcp'))).toBe(join(resources, 'ffmpeg', 'ffprobe'))
  })

  it('finds the fetched copy from anywhere in a checkout, sources or build', () => {
    scratch = mkdtempSync(join(tmpdir(), 'talkie-media-'))
    mkdirSync(join(scratch, 'vendor', 'ffmpeg', KEY), { recursive: true })
    writeFileSync(join(scratch, 'vendor', 'ffmpeg', KEY, 'ffmpeg'), '')
    mkdirSync(join(scratch, 'src', 'main', 'media'), { recursive: true })

    expect(toolPath('ffmpeg', join(scratch, 'src', 'main', 'media'))).toBe(join(scratch, 'vendor', 'ffmpeg', KEY, 'ffmpeg'))
    expect(toolPath('ffmpeg', join(scratch, 'out', 'main'))).toBe(join(scratch, 'vendor', 'ffmpeg', KEY, 'ffmpeg'))
  })

  it('says how to fetch it when it is not there, rather than failing at the first export', () => {
    scratch = mkdtempSync(join(tmpdir(), 'talkie-media-'))

    expect(() => toolPath('ffprobe', scratch!)).toThrow(/scripts\/fetchFfmpeg\.mjs --ensure/)
  })

  it('knows a packaged build by its archive, and a checkout by its absence', () => {
    expect(packagedResources('/A/Talkie.app/Contents/Resources/app.asar/out/main')).toBe('/A/Talkie.app/Contents/Resources')
    expect(packagedResources('/Users/someone/talkie/out/main')).toBeNull()
  })

  it('finds this checkout’s own copy', () => {
    expect(ffmpegPath()).toContain(join('vendor', 'ffmpeg', KEY, 'ffmpeg'))
    expect(ffprobePath()).toContain(join('vendor', 'ffmpeg', KEY, 'ffprobe'))
  })
})
```

`src/main/media/run.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { runFfmpeg, runFfprobe } from './run'

describe('running ffmpeg', () => {
  it('runs the pinned build and hands back what it printed', async () => {
    const { stdout } = await runFfmpeg(['-hide_banner', '-version'])

    expect(stdout).toMatch(/^ffmpeg version 9\.0\.2/)
  })

  it('runs ffprobe from the same build', async () => {
    const { stdout } = await runFfprobe(['-hide_banner', '-version'])

    expect(stdout).toMatch(/^ffprobe version 9\.0\.2/)
  })

  it('fails with what ffmpeg said, so a broken encode explains itself', async () => {
    await expect(runFfmpeg(['-i', '/no/such/file.mp4', '-f', 'null', '-'])).rejects.toThrow(/No such file or directory/)
  })

  it('stops when asked to, so a cancelled job leaves no ffmpeg behind', async () => {
    const controller = new AbortController()
    const run = runFfmpeg(['-f', 'lavfi', '-i', 'anullsrc', '-f', 'null', '-'], { signal: controller.signal })
    setTimeout(() => controller.abort(), 200)

    await expect(run).rejects.toThrow()
  }, 60_000)
})
```

`src/main/media/probe.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { probeMedia } from './probe'
import { runFfmpeg } from './run'

let dir: string
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'talkie-probe-'))
  // mpeg4 and aac are FFmpeg's own encoders, present in any build, so the fixture needs nothing else.
  await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', '-y', join(dir, 'clip.mp4')])
  await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=25:duration=1', '-c:v', 'mpeg4', '-y', join(dir, 'silent.mp4')])
}, 60_000)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('measuring media', () => {
  it('reads a clip’s length, size, rate, codec and whether it has sound', async () => {
    const info = await probeMedia(join(dir, 'clip.mp4'))

    expect(info.durationSeconds).toBeCloseTo(2, 1)
    expect(info).toMatchObject({ width: 320, height: 240, fps: 30, videoCodec: 'mpeg4', hasAudio: true })
  })

  it('says a silent clip has no sound', async () => {
    expect((await probeMedia(join(dir, 'silent.mp4'))).hasAudio).toBe(false)
  })

  it('fails on something that is not media, rather than reporting it as empty', async () => {
    await expect(probeMedia(join(dir, 'missing.mp4'))).rejects.toThrow()
  })
})
```

`src/main/media/encoders.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { chooseH264, h264 } from './encoders'

describe('choosing an H.264 encoder', () => {
  it('uses the Mac’s hardware encoder, at the quality recordings were stitched at', () => {
    expect(chooseH264('darwin', new Set(['h264_videotoolbox', 'aac']), 'intermediate')).toEqual(['-c:v', 'h264_videotoolbox', '-q:v', '65'])
  })

  it('refuses plainly on a system with no encoder Talkie has chosen, rather than reaching for a GPL one', () => {
    expect(() => chooseH264('win32', new Set(['libx264']), 'intermediate')).toThrow(/No H\.264 encoder/)
    expect(() => chooseH264('darwin', new Set(['libx264']), 'intermediate')).toThrow(/No H\.264 encoder/)
  })

  it.runIf(process.platform === 'darwin')('finds the hardware encoder in the pinned build', async () => {
    expect(await h264('intermediate')).toEqual(['-c:v', 'h264_videotoolbox', '-q:v', '65'])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/media`

Expected: the new four files FAIL to resolve `./binaries`, `./run`, `./probe` and `./encoders`. `ffmpegBuilds.test.ts` still passes.

- [ ] **Step 3: Write `src/main/media/binaries.ts`**

```ts
import { existsSync } from 'fs'
import { dirname, join } from 'path'

export type MediaTool = 'ffmpeg' | 'ffprobe'

const PLATFORM_KEY = `${process.platform}-${process.arch}`
const EXECUTABLE = process.platform === 'win32' ? '.exe' : ''

/**
 * The resources folder of the packaged build this code runs from, or null in a checkout.
 *
 * Read off the path rather than `process.resourcesPath`: the MCP server runs as plain node from
 * `app.asar.unpacked`, where that property does not exist, and it measures footage too.
 */
export function packagedResources(fromDir: string): string | null {
  const match = /^(.*?)[\\/]app\.asar(?:\.unpacked)?(?:[\\/]|$)/.exec(fromDir)
  return match ? match[1] : null
}

/**
 * Where ffmpeg or ffprobe is. In a packaged build, `Resources/ffmpeg/`, put there by
 * electron-builder's extraResources, because nothing can be executed from inside an asar archive.
 * In a checkout, `vendor/ffmpeg/<platform>-<arch>/`, fetched by scripts/fetchFfmpeg.mjs. Found
 * from this file's own folder, never the working directory, which is `/` for an app opened from
 * Finder.
 */
export function toolPath(tool: MediaTool, fromDir: string = __dirname): string {
  const resources = packagedResources(fromDir)
  if (resources) return join(resources, 'ffmpeg', tool + EXECUTABLE)

  // Up from src/main/media in the sources, out/main or out/mcp once built.
  let dir = fromDir
  for (let level = 0; level < 5; level++) {
    const candidate = join(dir, 'vendor', 'ffmpeg', PLATFORM_KEY, tool + EXECUTABLE)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`${tool} is not installed for ${PLATFORM_KEY}. Run \`node scripts/fetchFfmpeg.mjs --ensure\` in the Talkie folder.`)
}

export const ffmpegPath = (fromDir?: string): string => toolPath('ffmpeg', fromDir)
export const ffprobePath = (fromDir?: string): string => toolPath('ffprobe', fromDir)
```

- [ ] **Step 4: Write `src/main/media/run.ts`**

```ts
import { execFile } from 'child_process'
import { toolPath, type MediaTool } from './binaries'

export type ToolOutput = { stdout: string; stderr: string }

/** As much output as an ffmpeg run may print. Loudness measurement reads a JSON block off it. */
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024

/**
 * Runs ffmpeg with exactly the arguments given — no log level and no `-y` added — so a caller
 * reads the same output it always has.
 */
export function runFfmpeg(args: string[], options: { signal?: AbortSignal } = {}): Promise<ToolOutput> {
  return run('ffmpeg', args, options.signal)
}

export function runFfprobe(args: string[], options: { signal?: AbortSignal } = {}): Promise<ToolOutput> {
  return run('ffprobe', args, options.signal)
}

function run(tool: MediaTool, args: string[], signal: AbortSignal | undefined): Promise<ToolOutput> {
  return new Promise((resolve, reject) => {
    execFile(toolPath(tool), args, { maxBuffer: MAX_OUTPUT_BYTES, signal, encoding: 'utf-8' }, (error, stdout, stderr) => {
      if (error) {
        // The last lines are where ffmpeg says what went wrong; the rest is its stream listing.
        const said = stderr.trim().split('\n').slice(-12).join('\n')
        reject(new Error(`${tool} failed: ${error.message}${said ? `\n${said}` : ''}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}
```

- [ ] **Step 5: Write `src/main/media/probe.ts`**

```ts
import { runFfprobe } from './run'

export type MediaInfo = {
  durationSeconds: number | null
  width: number | null
  height: number | null
  fps: number | null
  videoCodec: string | null
  hasAudio: boolean
}

type Probed = {
  format?: { duration?: string }
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string }[]
}

/** "30/1" as 30; ffprobe writes "0/0" for a rate it does not know. */
function rate(fraction: string | undefined): number | null {
  const [numerator, denominator] = (fraction ?? '').split('/').map(Number)
  return numerator > 0 && denominator > 0 ? numerator / denominator : null
}

function seconds(value: string | undefined): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** What a recording, a take or an export is: how long, how big, and whether it has sound. */
export async function probeMedia(path: string): Promise<MediaInfo> {
  const { stdout } = await runFfprobe(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path])
  const probed = JSON.parse(stdout) as Probed
  const video = probed.streams?.find((stream) => stream.codec_type === 'video')
  return {
    // The container's length where it has one; a stream's otherwise.
    durationSeconds: seconds(probed.format?.duration) ?? seconds(video?.duration),
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: rate(video?.avg_frame_rate),
    videoCodec: video?.codec_name ?? null,
    hasAudio: probed.streams?.some((stream) => stream.codec_type === 'audio') ?? false
  }
}
```

- [ ] **Step 6: Write `src/main/media/encoders.ts`**

```ts
import { runFfmpeg } from './run'

/** What an encode is for. Step 3 of the renderer adds 'export', with the quality it chooses. */
export type EncodePurpose = 'intermediate'

type Encoder = { name: string; quality: Record<EncodePurpose, string[]> }

/**
 * Each system's H.264 encoders, best first; the first the installed ffmpeg offers is used.
 * Hardware encoders only: they carry no licence with them, which is what keeps a build of
 * ffmpeg without the GPL ones a substitution rather than a rewrite (see gplEncoders.test.ts).
 * Windows and Linux rows arrive with project 2.
 */
const H264: Partial<Record<NodeJS.Platform, Encoder[]>> = {
  // -q:v 65 is what recordings have always been stitched at: a small file that seeks cleanly.
  darwin: [{ name: 'h264_videotoolbox', quality: { intermediate: ['-q:v', '65'] } }]
}

export function chooseH264(platform: NodeJS.Platform, offered: ReadonlySet<string>, purpose: EncodePurpose): string[] {
  const encoder = (H264[platform] ?? []).find((candidate) => offered.has(candidate.name))
  if (!encoder) throw new Error(`No H.264 encoder Talkie can use on ${platform} is in this ffmpeg.`)
  return ['-c:v', encoder.name, ...encoder.quality[purpose]]
}

let offered: Promise<Set<string>> | null = null

/** Asked once: the list does not change while the app runs. */
function offeredEncoders(): Promise<Set<string>> {
  offered ??= runFfmpeg(['-hide_banner', '-encoders'])
    .then(({ stdout }) => new Set(stdout.split('\n').flatMap((line) => /^\s[VAS][A-Z.]{5}\s+(\S+)/.exec(line)?.[1] ?? [])))
    .catch((err: unknown) => {
      // Not remembered: a failure here is worth asking again about, not caching.
      offered = null
      throw err
    })
  return offered
}

export async function h264(purpose: EncodePurpose): Promise<string[]> {
  return chooseH264(process.platform, await offeredEncoders(), purpose)
}
```

- [ ] **Step 7: Write `src/main/media/index.ts`**

```ts
/**
 * Everything Talkie does with ffmpeg and ffprobe goes through here: finding them, running them,
 * measuring media, choosing an encoder. Nothing else spawns them (mediaBoundary.test.ts), so the
 * binaries, their location in a packaged build and the encoders per system are one module's
 * business, and Windows and Linux are rows added here rather than call sites hunted down.
 */
export { toolPath, ffmpegPath, ffprobePath, packagedResources, type MediaTool } from './binaries'
export { runFfmpeg, runFfprobe, type ToolOutput } from './run'
export { probeMedia, type MediaInfo } from './probe'
export { h264, chooseH264, type EncodePurpose } from './encoders'
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `npx vitest run src/main/media && npm run typecheck`

Expected: PASS, 5 test files. There are 4 + 5 + 4 + 3 + 3 = 19 tests, 18 off macOS. No type errors.

If `encoders.test.ts`'s parse finds no `h264_videotoolbox`, print the first lines of `runFfmpeg(['-hide_banner','-encoders'])`. The flags column is 6 characters wide, as in ` V....D h264_videotoolbox`. Fix the regex; never the expectation.

- [ ] **Step 9: Commit**

```bash
git add src/main/media/binaries.ts src/main/media/run.ts src/main/media/probe.ts src/main/media/encoders.ts src/main/media/index.ts src/main/media/binaries.test.ts src/main/media/run.test.ts src/main/media/probe.test.ts src/main/media/encoders.test.ts
git commit -m "$(cat <<'EOF'
Find, run and measure with Talkie's own ffmpeg through src/main/media

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The app's own calls go through `src/main/media`

**Files:**
- Modify:
  - `src/main/agent/clipEvidence.ts`, `src/main/capture/stitchRecording.ts`, `src/main/render/loudness.ts`
  - `src/main/setup/readiness.ts`, `src/main/transcript/recordNarration.ts`
  - `src/main/capture/importRecordedSession.ts`, `src/main/transcript/fitToFootage.ts`
  - `src/main/render/binaries.ts`

**Interfaces:**
- Consumes `runFfmpeg`, `probeMedia` and `h264` from `src/main/media` (Task 2). The import path is `'../media'` from each of these folders.
- Produces: no new exports. `src/main/render/binaries.ts` loses `ffOptions`; `binariesDirectory` stays, used by `renderProject.ts` only.

**Conversion rules.** Apply them exactly; the arguments themselves never change.

| Before | After |
|---|---|
| `await RenderInternals.callFf({ bin: 'ffmpeg', args: A, ...ffOptions(), cancelSignal: undefined })`, including any `logLevel` key | `await runFfmpeg(A)` |
| `const result = await RenderInternals.callFf({ … })` then `result.stdout`/`result.stderr` | `const result = await runFfmpeg(A)`; the same fields exist |
| `await getVideoMetadata(p, { binariesDirectory: binariesDirectory() })` then `durationInSeconds` | `await probeMedia(p)` then `durationSeconds` |

Then drop any `@remotion/renderer`, `ffOptions` or `binariesDirectory` import that is no longer used.

- [ ] **Step 1: Convert the call sites**
  - **`clipEvidence.ts:194`:** apply the rule.
  - **`recordNarration.ts:59`:** apply the rule.
  - **`loudness.ts:55,108,154`:** apply the rule to all three. At `:57-58`, the comment "the ffmpeg shipped with Remotion has nothing to encode it with for that" becomes: "the null muxer would otherwise want the picture encoded too, which a loudness reading has no use for".
  - **`readiness.ts:71`:** `await runFfmpeg(['-version'])`. The comment above it becomes: "ffmpeg is fetched on install and packaged beside the app, but it is a native binary that an interrupted install or a packaging slip can leave missing, so it is proven rather than assumed." The `fix` text becomes: `'The video tools could not be run. In a checkout, run `node scripts/fetchFfmpeg.mjs --ensure`; otherwise reinstall the app.'`. Write it as a template literal so the backticks survive.
  - **`stitchRecording.ts`:** delete `'-c:v', 'h264_videotoolbox', '-q:v', '65',` from `ENCODE_ARGS`; the rest of the constant stays. Then the call becomes `await runFfmpeg([...inputs, ...join, ...(await h264('intermediate')), ...ENCODE_ARGS, outputPath])`. Above `ENCODE_ARGS`, add the comment `// The encoder and its quality come from src/main/media's table, per system.`
  - **`importRecordedSession.ts:82`:** `const { durationSeconds } = await probeMedia(playablePath)`, and use `durationSeconds` in the two lines after it.
  - **`fitToFootage.ts:86`:** `const { durationSeconds } = await probeMedia(src)`; rename the uses. The comment `// See binaries.ts: a packaged build cannot run these from inside the asar archive.` goes, since `src/main/media` owns that now.

- [ ] **Step 2: Trim `src/main/render/binaries.ts`**

Delete `ffOptions` and its docblock. Replace the file's opening docblock with:

```ts
/**
 * Where Remotion's own compositor binaries are, for Remotion's export (renderMedia and
 * selectComposition in renderProject.ts) and nothing else; everything Talkie runs itself goes
 * through src/main/media. Goes with step 3 of the renderer, when Talkie's own export replaces it.
 *
 * Remotion resolves them relative to its own package, which works while the app runs from a
 * checkout. In a packaged build the code lives inside an asar archive, and a native binary
 * cannot be executed from there — electron-builder copies it out to `app.asar.unpacked`, and
 * nothing rewrites Remotion's idea of where it went.
 */
```

- [ ] **Step 3: Check nothing outside the tests still calls Remotion's ffmpeg**

Run: `grep -rnE "RenderInternals|getVideoMetadata|ffOptions" src/main --include='*.ts' | grep -v '\.test\.ts'`

Expected: no output.

- [ ] **Step 4: Run the types and the tests nearest each file**

Run: `npm run typecheck && npx vitest run src/main/media src/main/agent/clipEvidence.test.ts src/main/capture src/main/render/loudness.test.ts src/main/setup src/main/transcript`

Expected:
- **Types:** `binaries.test.ts` and `packagedBinaries.test.ts` still import `ffOptions`, which fails. Task 4 fixes them.
- **Everything else:** PASS, apart from the tests that still use `RenderInternals.callFf` or `getVideoMetadata` themselves. They have their own `@remotion/renderer` import and still pass.

If typecheck fails anywhere other than those two test files, fix it here.

- [ ] **Step 5: Commit**

The pre-commit hook type-checks, and the two test files from step 4 fail it. So Tasks 3 and 4 are one unit of work and one review, and are committed together: carry on to Task 4, and commit at its end with both messages' content. Do not use `--no-verify`.

---

### Task 4: The tests, e2e and the tour go through `src/main/media` too

**Files:**
- Modify:
  - Under `src/main/capture/`: `recordedScenes.test.ts`, `recordSession.test.ts`, `wholeSession.test.ts`
  - Under `src/main/render/`: `htmlSceneExport.test.ts`, `loudness.test.ts`, `themedExport.test.ts`, `binaries.test.ts`, `packagedBinaries.test.ts`
  - Under `src/main/transcript/`: `fitToFootage.test.ts`, `narrationFits.test.ts`, `recordNarration.test.ts`
  - Outside `src/main/`: `e2e/export.e2e.ts`, `examples/build/tour/cutFootage.ts`

**Interfaces:**
- Consumes: `runFfmpeg`, `probeMedia`, `ffmpegPath` and `ffprobePath` from `src/main/media`.
  - From `src/main/<folder>/` the import path is `'../media'`.
  - From `e2e/` it is `'../src/main/media'`.
  - From `examples/build/tour/` it is `'../../../src/main/media'`.

- [ ] **Step 1: Convert the nine test files that run ffmpeg**

Apply Task 3's conversion rules, with these additions:

| Before | After |
|---|---|
| `getVideoMetadata(p)` → `{ width, height }` | `probeMedia(p)` → `{ width, height }` |
| `getVideoMetadata(p)` → `{ durationInSeconds, codec }` | `probeMedia(p)` → `{ durationSeconds, videoCodec }` |

Rename the uses to match: `expect(videoCodec).toBe('h264')`.

Do not change any expected value or tolerance. If a test now fails, report the output. The pinned build is FFmpeg 9.0.2 where Remotion's was 7.1, so a real difference in output is possible, and it must be investigated, not absorbed.

- [ ] **Step 2: Rewrite `src/main/render/binaries.test.ts`**

Remove the `ffOptions` import and the test "gives every ffmpeg call the same options…". The other two tests stay as they are.

- [ ] **Step 3: Rewrite `src/main/render/packagedBinaries.test.ts`**

Keep its docblock's history, but add a final paragraph:

"Talkie's own ffmpeg calls go through src/main/media, which finds its binaries from its own folder (binaries.test.ts there). What is left here is Remotion's export, which still runs on Remotion's compositor until step 3 of the renderer."

Then make two changes:
- Reduce `CALLS_A_BINARY` to its two `renderProject.ts` rows, `selectComposition` and `renderMedia`.
- Replace the test "leaves no callFf without it…" with:

```ts
  it('ships Talkie’s own ffmpeg outside the archive, where src/main/media looks for it', () => {
    const builder = readFileSync(join(MAIN, '..', '..', 'electron-builder.yml'), 'utf-8')

    // packagedResources() + 'ffmpeg' is where toolPath looks in a packaged build.
    expect(builder).toMatch(/- from: vendor\/ffmpeg\/\$\{platform\}-\$\{arch\}\s+to: ffmpeg/)
  })
```

This test fails until Task 5 adds the entry. Mark it `it.todo` with that name for now, and Task 5 turns it back into `it`. Then a commit here passes the hook.

- [ ] **Step 4: Convert `e2e/export.e2e.ts`**

Delete the `BINARIES` constant. Replace `execFileSync(join(BINARIES, 'ffprobe'), args, { env: … })` with `execFileSync(ffprobePath(), args)`, and do the same for `ffmpeg` with `ffmpegPath()`. The `DYLD_LIBRARY_PATH` env goes: the pinned build is statically linked.

The two comments change:
- `:18` becomes `/** The ffmpeg and ffprobe the app itself uses, so the run needs nothing else installed. */`
- `:34`'s "because the ffmpeg Remotion ships has neither `volumedetect` nor a raw PCM muxer" becomes "decoded to PCM and measured here rather than by a filter, which keeps the measurement the same whatever ffmpeg build is installed".

- [ ] **Step 5: Convert `examples/build/tour/cutFootage.ts`**

Delete `BINARIES` and `ENV`. Every `join(BINARIES, 'ffmpeg')` becomes `ffmpegPath()`, and `join(BINARIES, 'ffprobe')` becomes `ffprobePath()`. Drop every `{ env: ENV }` argument.

Then rework the comment at `:24-26`, and only the comment. It currently begins "The ffmpeg Remotion ships can crop and scale but has no `pad` or `overlay`". Its new first sentence: "Written for the ffmpeg Remotion shipped, which had no `pad` or `overlay`; kept, since it draws the same frames with any build." Keep the rest of the comment as it is. Do not change the drawing code.

- [ ] **Step 6: Check, and check the tour still measures footage**

Run: `npm run typecheck && npx vitest run src/main`

Expected: no type errors; every `src/main` test passes, with `packagedBinaries`'s todo shown as todo.

Then check the tour still measures shipped footage. Write `.length-check.ts` at the worktree root:

```ts
import { readdirSync } from 'fs'
import { lengthMs } from './examples/build/tour/cutFootage'
const tour = 'examples/projects/meet-talkie/project/sources/tour'
console.log(lengthMs(`${tour}/${readdirSync(tour)[0]}/clip.mp4`))
```

Run: `npx vite-node .length-check.ts && rm .length-check.ts`

Expected: a positive number of milliseconds, and the file removed.

- [ ] **Step 7: Commit Tasks 3 and 4 together**

```bash
git add src/main/agent/clipEvidence.ts src/main/capture/stitchRecording.ts src/main/render/loudness.ts src/main/setup/readiness.ts src/main/transcript/recordNarration.ts src/main/capture/importRecordedSession.ts src/main/transcript/fitToFootage.ts src/main/render/binaries.ts \
  src/main/capture/recordedScenes.test.ts src/main/capture/recordSession.test.ts src/main/capture/wholeSession.test.ts src/main/render/htmlSceneExport.test.ts src/main/render/loudness.test.ts src/main/render/themedExport.test.ts src/main/transcript/fitToFootage.test.ts src/main/transcript/narrationFits.test.ts src/main/transcript/recordNarration.test.ts src/main/render/binaries.test.ts src/main/render/packagedBinaries.test.ts e2e/export.e2e.ts examples/build/tour/cutFootage.ts
git commit -m "$(cat <<'EOF'
Run every ffmpeg and ffprobe Talkie needs through src/main/media

Recording, narration, loudness, readiness, footage measurement, the tests, the e2e run and the
tour stop reaching into Remotion's compositor. Only Remotion's own export still uses it, until
step 3.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The boundary, and the packaged build

**Files:**
- Create: `src/main/media/mediaBoundary.test.ts`
- Modify: `src/video/videoBoundary.test.ts` (`MAIN_PROCESS_PLACES`), `electron-builder.yml`, `src/main/render/packagedBinaries.test.ts` (the todo becomes a test)

**Interfaces:**
- Consumes: everything from Tasks 2–4.

- [ ] **Step 1: Write the guard**

`src/main/media/mediaBoundary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

/**
 * ffmpeg and ffprobe are reached through src/main/media and nowhere else.
 *
 * They are native binaries whose location differs between a checkout and a packaged build, whose
 * licence depends on which encoders are asked for, and whose Windows and Linux builds arrive
 * with project 2. Each of those used to be every call site's problem: the getVideoMetadata call
 * that was never told where the binaries were worked in a checkout and cut every packaged
 * recording to three seconds. Read off the source, tests included, because one convenient
 * direct call works perfectly everywhere the suite looks.
 */
const ROOT = join(__dirname, '..', '..', '..')
const SCANNED = ['src', 'scripts', 'e2e', join('examples', 'build')]
const MEDIA = join('src', 'main', 'media') + sep
/** Remotion's own export, on Remotion's compositor until step 3 replaces it. */
const UNTIL_STEP_3 = [join('src', 'main', 'render', 'binaries.ts')]

const FORBIDDEN: { what: string; pattern: RegExp }[] = [
  { what: "Remotion's ffmpeg wrappers", pattern: /RenderInternals\.callFf|callFfNative|getVideoMetadata\s*\(/ },
  { what: "Remotion's compositor binaries", pattern: /@remotion\/compositor-/ },
  { what: 'a spawn of ffmpeg by name', pattern: /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|execa)\s*\(\s*['"`]ff(?:mpeg|probe)\b/ },
  { what: 'a path built to an ffmpeg binary', pattern: /\bjoin\s*\([^)]*['"`]ff(?:mpeg|probe)(?:\.exe)?['"`]\s*\)/ },
  { what: 'an ffmpeg binary package', pattern: /['"](?:ffmpeg-static|ffprobe-static|@ffmpeg-installer\/[^'"]+|@ffprobe-installer\/[^'"]+)['"]/ }
]

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.(ts|tsx|mjs|js|cjs)$/.test(entry)) found.push(path)
  }
  return found
}

describe('the line around ffmpeg', () => {
  it('finds the media module building its own path, so a pattern that matches nothing cannot pass', () => {
    const own = readFileSync(join(ROOT, 'src', 'main', 'media', 'run.ts'), 'utf-8')
    expect(/execFile\(toolPath/.test(own)).toBe(true)
  })

  it('lets nothing outside src/main/media run ffmpeg or ffprobe its own way', () => {
    const offenders = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .map((file) => relative(ROOT, file))
      .filter((file) => !file.startsWith(MEDIA) && !UNTIL_STEP_3.includes(file))
      .flatMap((file) => {
        const source = readFileSync(join(ROOT, file), 'utf-8')
        return FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(({ what }) => `${file} uses ${what}`)
      })

    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run it, and prove it bites**

Run: `npx vitest run src/main/media/mediaBoundary.test.ts`

Expected: PASS, 2 tests. If it lists offenders, convert each one as Task 3 or Task 4 did. Do not add to `UNTIL_STEP_3`.

Then plant `execFileSync('ffprobe', ['-version'])` as the last line of `src/main/agent/clipEvidence.ts`, run the guard, and confirm it fails naming that file. Remove the line, and confirm `git diff src/main/agent/clipEvidence.ts` is empty.

- [ ] **Step 3: Narrow the Remotion guard to what is left**

In `src/video/videoBoundary.test.ts`, set `MAIN_PROCESS_PLACES` to `[join('src', 'main', 'render') + sep, join('scripts') + sep]`. In its docblock, the sentence about the main process becomes: "Remotion's export (@remotion/renderer, @remotion/bundler) is all that is left of it in the main process, in src/main/render; step 3 replaces it."

Run: `npx vitest run src/video/videoBoundary.test.ts`

Expected: PASS. If something outside `src/main/render` still imports `@remotion/renderer`, it was missed in Task 3 or Task 4; convert it.

- [ ] **Step 4: Package Talkie's ffmpeg outside the archive**

In `electron-builder.yml`, under `extraResources:`, add after the `licences` entry:

```yaml
  # Talkie's own ffmpeg and ffprobe, fetched by scripts/fetchFfmpeg.mjs. Outside the archive
  # because nothing can be executed from inside it; src/main/media finds them here.
  - from: vendor/ffmpeg/${platform}-${arch}
    to: ffmpeg
```

Leave `node_modules/@remotion/compositor-**/**` in `asarUnpack`, because Remotion's export still needs it until step 3. In the `asarUnpack` comment above it, the sentence "Remotion's compositor carries the ffmpeg this app uses for transcoding, frame sampling and audio conversion" becomes "Remotion's compositor carries the ffmpeg Remotion's export renders with".

In `src/main/render/packagedBinaries.test.ts`, turn the `it.todo` from Task 4 back into the `it(...)` test written there.

Run: `npx vitest run src/main/render/packagedBinaries.test.ts`. Expected: PASS.

- [ ] **Step 5: Check a packaged build carries and runs it**

Run: `npm run build && npx electron-builder --dir --config electron-builder.yml && ls release/*/Talkie.app/Contents/Resources/ffmpeg/ && release/*/Talkie.app/Contents/Resources/ffmpeg/ffmpeg -hide_banner -version | head -1`

Expected: `ffmpeg ffprobe`, then `ffmpeg version 9.0.2…`.

If the folder is missing, check whether electron-builder expanded `${platform}`. The build output names the copied path. If it was not expanded, rename the vendor folders and the table keys from `darwin`/`win32` to electron-builder's `${os}` values (`mac`/`win`, with `linux` unchanged). Then use `${os}-${arch}` in the yml, and map `process.platform` to the same names in `toolPath` and `fetchFfmpeg.mjs`. Record the change in the report. Do not leave the two naming schemes mixed.

Then remove the build output with `rm -rf release/*/`. It is gitignored (`# Packaged builds`), but large.

- [ ] **Step 6: Commit**

```bash
git add src/main/media/mediaBoundary.test.ts src/video/videoBoundary.test.ts electron-builder.yml src/main/render/packagedBinaries.test.ts
git commit -m "$(cat <<'EOF'
Hold every use of ffmpeg to src/main/media, and package it beside the app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Say where ffmpeg comes from now

**Files:**
- Modify: `README.md` (the "Exporting video" row near line 212; the section "### The bundled ffmpeg is GPL"), `NOTICE` (the FFmpeg section), `scripts/generateNotices.mjs` (`BUNDLED`), `src/renderer/src/notices.json` or wherever `npm run notices` writes, `AGENTS.md`, the spec

**Interfaces:** none. Documentation only, plus the regenerated notices data.

- [ ] **Step 1: README**

- **The "Exporting video" row:** "Nothing — ffmpeg ships inside the app" becomes "Nothing — `npm install` fetches a pinned ffmpeg".
- **The section heading:** "### The bundled ffmpeg is GPL" becomes "### ffmpeg is GPL".
- **The section's opening paragraph** is replaced with:

```markdown
Talkie runs FFmpeg 9.0.2 from [Martin Riedl's build server](https://ffmpeg.martin-riedl.de),
pinned and hash-checked by `scripts/fetchFfmpeg.mjs` on `npm install` — a GPL-3.0 build
(`--enable-gpl --enable-version3`, with x264 and x265 linked in) with nothing nonfree in it. It is
**not in this repository**. Until Talkie's own export replaces Remotion's, Remotion's compositor
package also brings its own GPL ffmpeg, which only that export uses.
```

The table and the paragraphs after it stay.

- [ ] **Step 2: NOTICE**

Replace the section headed `FFmpeg, x264, x265 -- GPL-2.0-or-later` down to the line before the `x264 source:` link list. Leave the source links and the paragraphs after them, but edit "Recording and export both ask for h264_videotoolbox" to "Recording asks for h264_videotoolbox, and Talkie's own export will". The replacement:

```
--------------------------------------------------------------------------------
FFmpeg, x264, x265 -- GPL
--------------------------------------------------------------------------------

Talkie runs FFmpeg 9.0.2 as built by Martin Riedl (https://ffmpeg.martin-riedl.de),
configured --enable-gpl --enable-version3 with x264 and x265 linked in, which
makes the binaries GPL-3.0-or-later. `npm install` fetches them, pinned by
SHA-256 in scripts/ffmpegBuilds.json, into vendor/ffmpeg/. A packaged build
carries them in Contents/Resources/ffmpeg/.

Until Talkie's own export replaces Remotion's (step 3 of the renderer),
Remotion's compositor package (@remotion/compositor-*) also brings an FFmpeg
n7.1 built with --enable-gpl, --enable-libx264 and --enable-libx265
(GPL-2.0-or-later), used only by that export.

None of these binaries is part of this repository.

This matters when binaries are distributed, not when source is:

  * Publishing or cloning THIS SOURCE REPOSITORY carries no GPL obligation,
    because no GPL code is contained in it.

  * Distributing a BUILT APPLICATION (a .dmg, a GitHub release asset, an app
    store submission) does distribute those GPL binaries. Whoever does that
    becomes a GPL distributor and must comply -- which includes offering the
    corresponding source of FFmpeg and its GPL dependencies to every recipient,
    and imposing no further restrictions on the rights the GPL grants them.

The corresponding source of the Riedl build is the FFmpeg 9.0.2 release and
the build scripts its server publishes; a distributor publishes those beside
the download. `ffmpeg -buildconf` on vendor/ffmpeg/<system>/ffmpeg prints its
exact configuration.
```

Then delete the subsection "Which version of the GPL applies, and what a source offer has to be" only if it is now redundant: it speaks of FFmpeg n7.1 and GPLv2 versus v3. Keep it, but begin it with "For Remotion's FFmpeg n7.1:". Keep "Two things worth settling with Remotion…" as it is, since those binaries are still installed.

- [ ] **Step 3: The in-app notices**

In `scripts/generateNotices.mjs`, change `BUNDLED`'s FFmpeg entry to:

```js
  {
    name: 'FFmpeg',
    version: '9.0.2',
    license: 'GPL-3.0-or-later',
    textFile: 'licences/GPL-3.0.txt',
    note:
      'Fetched on install from ffmpeg.martin-riedl.de, pinned by SHA-256, and used for recording, ' +
      'frame sampling, audio and measuring footage. Built with --enable-gpl --enable-version3, x264 ' +
      'and x265. Source: https://ffmpeg.org/download.html',
    homepage: 'https://ffmpeg.martin-riedl.de'
  },
  {
    name: 'FFmpeg (inside Remotion)',
    version: 'n7.1',
    license: 'GPL-2.0-or-later',
    textFile: 'licences/GPL-2.0.txt',
    note:
      "Shipped inside Remotion's compositor and used only by Remotion's export, until Talkie's own " +
      'replaces it. Built with --enable-gpl, --enable-libx264 and --enable-libx265.',
    homepage: 'https://ffmpeg.org'
  },
```

Then change the x264 and x265 entries' `version` to `'bundled with FFmpeg 9.0.2 and n7.1'`.

Run: `npm run notices && npx vitest run src/main/render/licences.test.ts src/renderer`

Expected: notices regenerated; PASS. If a test pins the exact FFmpeg entry, update its expected value to the new entry and say so in the report.

- [ ] **Step 4: AGENTS.md**

- **Commands block:** the line `npm run dev               # electron-vite dev` stays. Add a sentence after the paragraph that begins "Run `npm test` and `npm run typecheck` before committing.":

  "`npm install` also fetches the pinned ffmpeg and ffprobe into `vendor/ffmpeg/` (`scripts/fetchFfmpeg.mjs`); `npm run dev` checks they are there."

- **"Things that will bite you":** replace the bullet that begins "**Anything that shells out has to be told where the binaries are**" with:

```markdown
- **ffmpeg and ffprobe are reached only through `src/main/media/`.** They are pinned builds
  (`scripts/ffmpegBuilds.json`, GPL-3.0, nothing nonfree — `ffmpeg-static`'s macOS build calls
  itself not redistributable, and `ffprobe-static`'s Apple Silicon binary does not run), fetched
  into `vendor/ffmpeg/<platform>-<arch>/` and packaged into `Resources/ffmpeg/` as extraResources.
  `toolPath()` finds them from its own folder — the path up to `app.asar`, or up to the checkout
  — never the working directory and never `process.resourcesPath`, which the MCP server does not
  have. It used to be every call site's job: one `getVideoMetadata` call was never told where the
  binaries were, and every packaged recording arrived as three seconds of its opening.
  `mediaBoundary.test.ts` fails on any other way in. Encoders come from `h264()`'s table per
  system, hardware only. Remotion's export still uses its own compositor until step 3
  (`render/binaries.ts`, `packagedBinaries.test.ts`).
```

- **"Licensing — read before distributing anything":** in the bullet "**The ffmpeg inside Remotion's compositor is GPL-2.0-or-later**…", rewrite it as:

  "**ffmpeg is GPL**: Talkie's own (FFmpeg 9.0.2, GPL-3.0-or-later) is fetched by `npm install`, and Remotion's compositor brings another (GPL-2.0-or-later) until step 3. Neither is in this repository."

- [ ] **Step 5: The spec**

In `docs/superpowers/specs/2026-10-13-own-renderer-design.md`:

- **The Decisions table's ffmpeg row** becomes: "Pinned builds of ffmpeg and ffprobe (GPL-3.0, nothing nonfree) fetched and hash-checked by `scripts/fetchFfmpeg.mjs`, behind one module, with an encoder table per system. Not `ffmpeg-static`/`ffprobe-static`; see §2."
- **§2's "Binaries" bullet** becomes: "**Binaries:** pinned FFmpeg 9.0.2 builds from ffmpeg.martin-riedl.de for macOS and Linux (arm64, x64), fetched into `vendor/ffmpeg/<platform>-<arch>/` on install and packaged into `Resources/ffmpeg/`; Windows' row (BtbN's builds) is project 2's. `ffmpegPath()`/`ffprobePath()` find them from their own folder."
- **§2's "First task of step 2" paragraph:** append "Done while planning step 2: `ffmpeg-static` has the encoders and filters, but its macOS build is `--enable-nonfree` and calls itself not legally redistributable, and `ffprobe-static`'s Apple Silicon binary does not run — so the fallback was taken."
- **§2's "Install failures" bullet** becomes: "`scripts/fetchFfmpeg.mjs` runs on install and warns if it cannot fetch; `npm run dev` runs it with `--ensure`, which fails naming the same three causes as `ensureElectron.mjs`."

- [ ] **Step 6: Commit**

```bash
git add README.md NOTICE scripts/generateNotices.mjs AGENTS.md docs/superpowers/specs/2026-10-13-own-renderer-design.md
git add $(git status --porcelain | awk '/notices\.json$/ {print $2}')
git commit -m "$(cat <<'EOF'
Say where Talkie's ffmpeg comes from, and what its licence asks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Every gate, as a push would run them

**Files:** none changed, unless a gate fails.

- [ ] **Step 1: Types and the whole suite**

Run: `npm run typecheck && npm test`

Expected: no type errors and every test passing. That is 1591 from step 1, plus 4 for the pinned table, 19 for the module (18 off macOS) and 2 for the guard. Take away the one `ffOptions` test and `packagedBinaries`' two `getVideoMetadata` rows. Total: 1613.

- [ ] **Step 2: The end-to-end run**

Run: `npm run e2e`

Expected: 11/11. These include the export test, which now measures with the pinned ffprobe.

- [ ] **Step 3: Confirm step 2 is done, as the spec defines it**

Run: `grep -rnE "RenderInternals\.callFf|getVideoMetadata|@remotion/compositor-" src scripts e2e examples/build | grep -v "^src/main/media/" | grep -v "^src/main/render/binaries.ts"`

Expected: no output, apart from the strings inside `src/main/media/mediaBoundary.test.ts`'s own patterns.

- [ ] **Step 4: Report**

Tell the user:
- the branch is ready for a PR, stacked on #26;
- the test count;
- why the pinned build was chosen over `ffmpeg-static`;
- that Remotion's compositor is still installed for Remotion's export until step 3.

Do not push.
