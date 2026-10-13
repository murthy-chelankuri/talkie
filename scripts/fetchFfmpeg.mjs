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
