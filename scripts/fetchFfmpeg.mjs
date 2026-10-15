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
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const table = JSON.parse(readFileSync(join(root, 'scripts', 'ffmpegBuilds.json'), 'utf-8'))
const key = `${process.platform}-${process.arch}`
const ensure = process.argv.includes('--ensure')
const target = join(root, 'vendor', 'ffmpeg', key)
const BINARIES = ['ffmpeg', 'ffprobe']

/**
 * Both binaries, from the build the table names. A half-finished fetch has no build.json. The
 * hashes are compared as well as the version: a build re-pinned within one version is a
 * different file, and comparing the version alone would keep the old one.
 */
function installed(build) {
  try {
    const stamp = JSON.parse(readFileSync(join(target, 'build.json'), 'utf-8'))
    return (
      stamp.version === build.version &&
      BINARIES.every((name) => stamp[name] === build[name].sha256 && existsSync(join(target, name)))
    )
  } catch {
    return false
  }
}

/**
 * Unpacks with the system's own bsdtar (`/usr/bin/tar` on macOS, `tar.exe` on Windows 10 and
 * later), which reads zips. It was extract-zip, which on a managed laptop — security software
 * between it and the disk — once neither finished nor failed: its promise simply never settled,
 * Node ran out of things to wait for and quit with "unsettled top-level await", and `npm run dev`
 * stopped with no reason given. A child process run synchronously can only succeed or say why not.
 */
function unzip(zip, dir) {
  try {
    execFileSync('tar', ['-xf', zip, '-C', dir], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 5 * 60_000 })
  } catch (err) {
    const said = err.stderr?.toString().trim()
    throw new Error(`could not unpack ${zip}${said ? `: ${said}` : err.signal ? ` (stopped after ${err.signal})` : ''}`)
  }
}

/** Downloads to `to`, hashing as it goes, and keeps the file only if it is the one pinned. */
async function download({ url, sha256 }, to) {
  // A proxy that accepts the connection and then says nothing would otherwise hang an install.
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) })
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
    `  2. ${table.source} could not be reached — a proxy or VPN may refuse it. Node's download does not follow npm's proxy settings.`,
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
  let failure = null
  try {
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    for (const name of BINARIES) {
      const zip = join(staging, `${name}.zip`)
      await download(build[name], zip)
      unzip(zip, staging)
      chmodSync(join(staging, name), 0o755)
    }
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    for (const name of BINARIES) renameSync(join(staging, name), join(target, name))
    // Written last: its presence is what says the fetch finished.
    writeFileSync(join(target, 'build.json'), JSON.stringify(
        { version: build.version, source: table.source, ffmpeg: build.ffmpeg.sha256, ffprobe: build.ffprobe.sha256 },
        null,
        2
      ) + '\n')
    console.log(`ffmpeg ${build.version} is in vendor/ffmpeg/${key}`)
  } catch (err) {
    failure = err
  } finally {
    // Before fail(), which under --ensure exits the process and would skip this.
    rmSync(staging, { recursive: true, force: true })
  }
  if (failure) fail(`Could not fetch ffmpeg: ${failure instanceof Error ? failure.message : failure}`)
}
