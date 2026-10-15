import { createHash } from 'crypto'
import { copyFileSync, createReadStream, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { KOKORO_FILES, KOKORO_MODEL, kokoroFileUrl, kokoroModelDir, type KokoroFile } from './kokoroModel'

/**
 * Bringing the Kokoro voice in by hand, for a machine that cannot fetch it.
 *
 * The download is a plain HTTPS fetch from Hugging Face, and a corporate proxy is the usual reason
 * it fails: the app is refused where a browser — signed in to the proxy, or on another machine — is
 * let through. So the files can be fetched any way that works and handed to Talkie, which checks
 * them exactly as it checks its own download. Nothing here reaches the network.
 */

export interface KokoroManualFile {
  /** Its path inside the folder, and on Hugging Face. */
  path: string
  url: string
  bytes: number
  sha256: string
}

export interface KokoroManual {
  /** Where the files go, for anyone copying them in themselves. */
  folder: string
  /** The same, as `~/…`, for showing. */
  displayFolder: string
  files: KokoroManualFile[]
  /** All of it as plain text, to keep, forward to whoever runs the proxy, or follow elsewhere. */
  instructions: string
}

export interface KokoroCheck {
  /** All four files are in place and are the published ones. */
  ready: boolean
  /** Paths inside the folder, for each thing wrong with them. */
  missing: string[]
  wrong: string[]
}

export interface KokoroImport extends KokoroCheck {
  /** Which of the voice's files the chosen ones turned out to be. */
  placed: string[]
  /** Chosen files that are none of them, by the name they were chosen under. */
  unrecognised: string[]
}

function manualFile(file: KokoroFile): KokoroManualFile {
  return { path: file.path, url: kokoroFileUrl(file), bytes: file.bytes, sha256: file.sha256 }
}

function megabytes(bytes: number): string {
  return bytes >= 1_000_000 ? `${Math.round(bytes / 1_000_000)} MB` : `${bytes} bytes`
}

/** A home-relative path reads as one a person could type, and is the same on every Mac. */
function tilde(path: string): string {
  const home = homedir()
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

export function kokoroManual(baseDir: string = homedir()): KokoroManual {
  const folder = kokoroModelDir(baseDir)
  const files = KOKORO_FILES.map(manualFile)
  const instructions = [
    'Talkie: downloading the Kokoro voice by hand',
    '',
    `Fetch these ${files.length} files — the pinned revision of ${KOKORO_MODEL.id} on Hugging Face. The`,
    'largest redirects to a Hugging Face download host (*.hf.co), which a proxy may need to allow too.',
    '',
    ...files.map((file) => `  ${file.url}\n    ${megabytes(file.bytes)}, SHA-256 ${file.sha256}`),
    '',
    'Then, in Talkie: Settings → AI → Kokoro → "Choose downloaded files…", and pick all four. Talkie',
    'recognises each by its contents, so it does not matter what the browser named them.',
    '',
    'Or copy them in yourself, keeping these exact names and the onnx folder:',
    '',
    ...files.map((file) => `  ${tilde(join(folder, file.path))}`),
    '',
    'and press "Check the files" in the same place.'
  ].join('\n')
  return { folder, displayFolder: tilde(folder), files, instructions }
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** What is wrong with the files in the folder, without changing any of them. */
export async function checkKokoroFiles(baseDir: string = homedir()): Promise<KokoroCheck> {
  const folder = kokoroModelDir(baseDir)
  const missing: string[] = []
  const wrong: string[] = []
  for (const file of KOKORO_FILES) {
    const path = join(folder, file.path)
    let bytes: number
    try {
      bytes = statSync(path).size
    } catch {
      missing.push(file.path)
      continue
    }
    // Size first: it rules out a proxy's page or a half-finished download without reading 160 MB.
    if (bytes !== file.bytes || (await sha256Of(path)) !== file.sha256) wrong.push(file.path)
  }
  return { ready: missing.length === 0 && wrong.length === 0, missing, wrong }
}

/**
 * Put chosen files where Kokoro looks for them, each recognised by its contents.
 *
 * By contents rather than name, because browsers rename what they save — `model_fp16 (1).onnx`,
 * or `tokenizer.json.download` — and a name proves nothing about what is inside. Anything that is
 * not one of the four is left where it is and named back. Each file is copied beside its final
 * place and then renamed into it, so Kokoro never finds half of one.
 */
export async function importKokoroFiles(chosen: string[], baseDir: string = homedir()): Promise<KokoroImport> {
  const folder = kokoroModelDir(baseDir)
  const placed: string[] = []
  const unrecognised: string[] = []

  for (const source of chosen) {
    let bytes: number
    try {
      bytes = statSync(source).size
    } catch {
      unrecognised.push(basename(source))
      continue
    }
    const candidates = KOKORO_FILES.filter((file) => file.bytes === bytes)
    const hash = candidates.length > 0 ? await sha256Of(source) : null
    const match = candidates.find((file) => file.sha256 === hash)
    if (!match) {
      unrecognised.push(basename(source))
      continue
    }

    const target = join(folder, match.path)
    const partial = `${target}.partial`
    mkdirSync(dirname(target), { recursive: true })
    try {
      copyFileSync(source, partial)
      renameSync(partial, target)
    } finally {
      rmSync(partial, { force: true })
    }
    if (!placed.includes(match.path)) placed.push(match.path)
  }

  return { ...(await checkKokoroFiles(baseDir)), placed, unrecognised }
}
