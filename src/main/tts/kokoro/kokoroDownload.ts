import { createHash } from 'crypto'
import { createReadStream, createWriteStream, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { KOKORO_FILES, kokoroFileUrl, kokoroModelDir, type KokoroFile } from './kokoroModel'

/**
 * Fetching the Kokoro voice, through the same network the person's browser uses.
 *
 * It was fetched by transformers.js inside the Kokoro worker, with Node's own `fetch` — which
 * ignores the Mac's proxy settings and trusts only the certificates Node ships with. A corporate
 * network needs both: requests sent through its proxy, and its own root certificate trusted,
 * because it re-signs every HTTPS connection it inspects. The browser had both and fetched the
 * files; Talkie had neither and could not. So the main process fetches them with whatever `fetch`
 * it is handed — Electron's `net.fetch` in the app, which is Chromium's network stack with the
 * system's proxy, its keychain and proxy sign-in — and the worker only ever reads them from disk.
 */

export type Fetch = (url: string) => Promise<Response>

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function isInPlace(path: string, file: KokoroFile): Promise<boolean> {
  try {
    return statSync(path).size === file.bytes && (await sha256Of(path)) === file.sha256
  } catch {
    return false
  }
}

/** An HTTP refusal, in terms of who most likely refused. */
function refusal(status: number, file: KokoroFile): Error {
  const by = status === 407 ? 'a proxy that wants signing in to' : status === 403 ? 'the network — often a proxy blocking the site' : 'Hugging Face'
  return new Error(`${file.path} was refused (HTTP ${status}) by ${by}.`)
}

/**
 * Every file of the voice, fetched into its folder and checked against the published one.
 *
 * A file already there and correct is kept, so a download that was interrupted carries on rather
 * than starting again. Each arrives beside its final place and is renamed in only once it has
 * been checked, so nothing half-written or substituted — a proxy's own page, most often — is ever
 * where Kokoro will look. Progress counts only what has to be fetched.
 */
export async function fetchKokoroFiles(
  fetchFile: Fetch,
  onProgress: (loaded: number, total: number) => void = () => undefined,
  baseDir: string = homedir(),
  files: KokoroFile[] = KOKORO_FILES,
  urlFor: (file: KokoroFile) => string = kokoroFileUrl
): Promise<void> {
  const folder = kokoroModelDir(baseDir)
  const needed: KokoroFile[] = []
  for (const file of files) {
    if (!(await isInPlace(join(folder, file.path), file))) needed.push(file)
  }

  const total = needed.reduce((sum, file) => sum + file.bytes, 0)
  let loaded = 0
  onProgress(loaded, total)

  for (const file of needed) {
    const target = join(folder, file.path)
    const partial = `${target}.partial`
    mkdirSync(dirname(target), { recursive: true })
    try {
      const response = await fetchFile(urlFor(file))
      if (!response.ok) throw refusal(response.status, file)
      if (!response.body) throw new Error(`${file.path} came back empty.`)

      const hash = createHash('sha256')
      let bytes = 0
      const out = createWriteStream(partial)
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          hash.update(chunk)
          bytes += chunk.length
          loaded += chunk.length
          // A proxy's page can be any length; stop reading once it is plainly not this file.
          if (bytes > file.bytes) break
          if (!out.write(chunk)) await new Promise<void>((resolve) => out.once('drain', () => resolve()))
          onProgress(Math.min(loaded, total), total)
        }
      } finally {
        await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
      }

      if (bytes !== file.bytes || hash.digest('hex') !== file.sha256) {
        throw new Error(
          `${file.path} did not match the published one, and was thrown away — a proxy may have answered in Hugging Face’s place.`
        )
      }
      renameSync(partial, target)
    } finally {
      rmSync(partial, { force: true })
    }
  }
}
