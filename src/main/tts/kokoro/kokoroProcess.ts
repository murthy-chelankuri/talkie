import { fork, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { KOKORO_MODEL, isKokoroDownloaded, kokoroCacheDir } from './kokoroModel'
import { fetchKokoroFiles, type Fetch } from './kokoroDownload'
import { retrySpeeds } from '../audibleTake'

/**
 * The main process's side of Kokoro: it starts the worker, sends it work, and never loads the
 * model itself. See kokoroWorker.ts for why the two are kept in separate processes.
 */

/**
 * The model holds a few hundred megabytes of memory. Narrating is bursty — a run of clips, then
 * nothing for an hour of editing — so the worker goes when it has been idle a while and comes back
 * on the next clip, at the cost of the half second it takes to load.
 */
const IDLE_MS = 5 * 60_000

type Reply =
  | { id: number; kind: 'progress'; loaded: number; total: number }
  | { id: number; kind: 'done'; seconds?: number }
  | { id: number; kind: 'error'; message: string }

interface Pending {
  resolve: (seconds: number | undefined) => void
  reject: (error: Error) => void
  onProgress?: (loaded: number, total: number) => void
}

/**
 * The built worker sits beside the main bundle. Run from source — the test suite — there is no
 * build, and the TypeScript is run directly: Node strips the types itself.
 */
export function workerPath(): string {
  const built = join(__dirname, 'kokoroWorker.cjs')
  return existsSync(built) ? built : join(__dirname, 'kokoroWorker.ts')
}

let child: ChildProcess | null = null
let nextId = 1
const pending = new Map<number, Pending>()
let idleTimer: NodeJS.Timeout | null = null

function settleAll(error: Error): void {
  for (const request of pending.values()) request.reject(error)
  pending.clear()
}

function worker(): ChildProcess {
  if (child && child.connected) return child

  const started = fork(workerPath(), [], {
    // In the packaged app process.execPath is Electron; this makes it behave as plain Node.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  })

  started.on('message', (reply: Reply) => {
    const request = pending.get(reply.id)
    if (!request) return
    if (reply.kind === 'progress') {
      request.onProgress?.(reply.loaded, reply.total)
      return
    }
    pending.delete(reply.id)
    if (reply.kind === 'done') request.resolve(reply.seconds)
    else request.reject(new Error(reply.message))
  })

  started.on('exit', (code) => {
    if (child === started) child = null
    if (pending.size > 0) settleAll(new Error(`Kokoro stopped unexpectedly (exit code ${code}).`))
  })

  child = started
  return started
}

function send(
  message: Record<string, unknown>,
  onProgress?: (loaded: number, total: number) => void
): Promise<number | undefined> {
  if (idleTimer) clearTimeout(idleTimer)

  const id = nextId++
  const result = new Promise<number | undefined>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
  })
  worker().send({ ...message, id })

  const rearm = (): void => {
    if (pending.size > 0) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(stopKokoro, IDLE_MS)
    idleTimer.unref()
  }
  result.then(rearm, rearm)
  return result
}

/** What the worker needs to find the model; the hash and size are this side's business. */
function modelSpec(baseDir: string): Record<string, string> {
  return { id: KOKORO_MODEL.id, revision: KOKORO_MODEL.revision, dtype: KOKORO_MODEL.dtype, cacheDir: kokoroCacheDir(baseDir) }
}

/** Read `text` into a 16-bit wav at `outputPath`; resolves with its length in seconds. */
export async function speakWithKokoro(
  text: string,
  voice: string,
  speed: number,
  outputPath: string,
  baseDir: string = homedir()
): Promise<number> {
  if (!isKokoroDownloaded(baseDir)) {
    throw new Error('The Kokoro voice has not been downloaded yet. Download it in Settings → AI.')
  }
  // A long take is read in pieces, and a piece can come back silent where the whole take would
  // not look it; the worker asks again for that piece alone, at the same nudges audibleTake uses.
  const seconds = await send({ kind: 'speak', model: modelSpec(baseDir), text, voice, speed, retrySpeeds: retrySpeeds(speed), outputPath })
  return seconds ?? 0
}

export function stopKokoro(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  const running = child
  child = null
  if (running) {
    settleAll(new Error('Kokoro was stopped.'))
    running.kill()
  }
}

export interface KokoroDownload {
  downloaded: boolean
  downloading: boolean
  /** Bytes so far and in all, while downloading. */
  loaded: number
  total: number
  /** Why the last attempt failed, said plainly. Cleared when another starts. */
  error?: string
}

interface DownloadState {
  promise: Promise<void>
  running: boolean
  loaded: number
  total: number
  error?: string
}

let download: DownloadState | null = null

/**
 * Fetch the model, once. A second call while one is running joins it rather than starting another.
 *
 * `fetchFile` is Electron's `net.fetch` in the app — the system's proxy and keychain, which a
 * corporate network needs; see kokoroDownload.ts. Plain `fetch` otherwise, for the tests. Once the
 * files are in place and checked, the worker loads them, so a download that cannot be spoken with
 * is found here rather than on the first clip.
 *
 * Settings polls `kokoroDownloadStatus` while this runs rather than being sent events: a progress
 * bar that is a fraction of a second behind costs nothing, and polling is one channel instead of
 * a channel and a listener that must be torn down with the window.
 */
export function downloadKokoro(baseDir: string = homedir(), fetchFile: Fetch = (url) => fetch(url)): Promise<void> {
  if (download?.running) return download.promise

  const state: DownloadState = { promise: Promise.resolve(), running: true, loaded: 0, total: 0 }
  state.promise = fetchKokoroFiles(
    fetchFile,
    (loaded, total) => {
      state.loaded = loaded
      state.total = total
    },
    baseDir
  )
    .then(() => send({ kind: 'prepare', model: modelSpec(baseDir) }))
    .then(() => undefined)
    .catch((err: Error) => {
      state.error = describeDownloadFailure(err.message)
      // The worker may be holding the model it just loaded from the bad file.
      stopKokoro()
      throw new Error(state.error)
    })
    .finally(() => {
      state.running = false
    })
  download = state
  return state.promise
}

export function kokoroDownloadStatus(baseDir: string = homedir()): KokoroDownload {
  const downloaded = !download?.running && isKokoroDownloaded(baseDir)
  return {
    downloaded,
    downloading: download?.running ?? false,
    loaded: download?.loaded ?? 0,
    total: download?.total ?? 0,
    error: downloaded ? undefined : download?.error
  }
}

/** What went wrong with the download, in terms of what to do about it. */
function describeDownloadFailure(message: string): string {
  // What a corporate proxy does to a fetch it will not allow: re-signs the connection with a
  // certificate of its own, asks for credentials, or cuts it. Said as a proxy, because "check the
  // connection" sends someone to a connection that works for everything else.
  if (/certificate|CERT_|SELF_SIGNED|ERR_PROXY|ERR_TUNNEL|ERR_SSL|\b40[37]\b|proxy/i.test(message)) {
    return 'A proxy or firewall stopped the download from Hugging Face. Download the files yourself and add them below.'
  }
  if (/fetch failed|net::ERR_|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(message)) {
    return 'Could not reach Hugging Face to download the voice. Try again, or download the files yourself and add them below.'
  }
  if (/ENOSPC/i.test(message)) return 'There is not enough disk space for the voice.'
  if (/did not match the published one/.test(message)) {
    return `${message} Download the files yourself and add them below.`
  }
  return `The voice could not be downloaded: ${message}`
}
