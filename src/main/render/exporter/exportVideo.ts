import { mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { once } from 'events'
import { randomBytes } from 'crypto'
import { dirname, extname, join } from 'path'
import { chromium, type Browser, type BrowserServer, type Page } from 'playwright'
import type { TimelineItem } from '../../../composition/types'
import type { RenderTheme } from '../../../composition/renderTheme'
import { FPS, HEIGHT, WIDTH } from '../../../composition/constants'
import { h264, runFfmpeg, spawnFfmpeg, type RunningTool } from '../../media'
import { browserExecutablePath } from '../../capture/resolveBrowser'
import { drawing, encoding, type ExportProgress } from '../exportProgress'
import { closeReaders } from './frameSource'
import { closeBrowserServer } from './closeWithin'
import { splitFrames, tabCount } from './ranges'
import { soundtrackArgs, takesFor } from './soundtrack'
import { raceAbort } from './raceAbort'

// The page declares window.talkie for the web project; this one is type-checked as node, so it
// names the two calls it makes rather than importing the page's sources (as exportPage.test.ts).
type TalkiePage = { load: (input: unknown) => Promise<void>; seek: (frame: number) => Promise<void> }

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

/**
 * High-definition colour, said and done: converted with BT.709 rather than BT.601's PAL, and
 * tagged so. The tags are set on the frames, in the graph: ffmpeg 9 takes an encode's colour
 * description from its frames, and `-color_primaries` / `-color_trc` given as output options
 * left both `unknown` in the file.
 */
const COLOUR = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv']

/**
 * Talkie's own export (spec §3): N headless tabs each draw a run of frames and pipe their
 * screenshots to an ffmpeg of their own; the runs are joined without re-encoding, and the
 * soundtrack is mixed from the timeline and muxed in.
 */
export async function exportVideo(input: OwnExportInput): Promise<void> {
  const { totalFrames, outputPath, onProgress, signal } = input
  if (!(totalFrames > 0)) throw new Error('Nothing to export: the timeline is empty.')
  signal?.throwIfAborted()
  const id = randomBytes(4).toString('hex')
  const parts = join(dirname(outputPath), `.parts-${id}`)
  mkdirSync(parts, { recursive: true })
  // Our own, so a failure in one tab stops the others as a cancel would.
  const stop = new AbortController()
  const forward = (): void => stop.abort(signal?.reason)
  signal?.addEventListener('abort', forward)
  // Launched as a server and connected to, rather than launched in-process, because only the server
  // hands over the browser's process to kill when it will not close.
  let server: BrowserServer | null = null
  let browser: Browser | null = null
  // One close, shared: a second browser.close() while the first is under way returns at once,
  // and the export returned with its browser still exiting.
  let closing: Promise<void> | null = null
  // Bounded: Playwright waits for Chromium's process to exit, and a headless shell that stalls on
  // its way out would leave Cancel unsettled and the project "already being exported" until restart.
  // Not remembered while there is no server yet: an abort during launch must not stop the close
  // in `finally` from running once there is one.
  const closeBrowser = (): Promise<void> => (server ? (closing ??= closeBrowserServer(browser, server)) : Promise.resolve())
  // Closing the browser is what ends a tab mid-seek: a frame's holds may wait 30 s, and a tab
  // only looks at the signal between frames.
  stop.signal.addEventListener('abort', () => void (server && closeBrowser()))
  try {
    server = await chromium.launchServer({ executablePath: browserExecutablePath() ?? undefined, headless: true })
    browser = await chromium.connect(server.wsEndpoint())
    stop.signal.throwIfAborted()
    const ranges = splitFrames(totalFrames, tabCount())
    const encode = await h264('export')
    let rendered = 0
    let failure: unknown = null
    const tabs = await Promise.allSettled(
      ranges.map(async (range, tab) => {
        const segment = join(parts, `segment-${String(tab).padStart(2, '0')}.mp4`)
        try {
          await captureRange(browser!, input, `${id}-${tab}`, range, segment, encode, stop.signal, () => {
            rendered++
            onProgress?.(drawing(rendered, totalFrames))
          })
        } catch (err) {
          // The first to fail is the reason; the rest fail because it stopped them.
          failure ??= err
          stop.abort(err)
          throw err
        }
        return segment
      })
    )
    // Every tab has finished, encoder and all, before anything is thrown: nothing outlives the call.
    signal?.throwIfAborted()
    const rejected = tabs.find((tab) => tab.status === 'rejected')
    if (rejected) throw failure ?? rejected.reason
    const segments = tabs.map((tab) => (tab as PromiseFulfilledResult<string>).value)

    onProgress?.(encoding(totalFrames))
    const list = join(parts, 'segments.txt')
    writeFileSync(list, segments.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join('\n') + '\n')
    // Each stage stopped by a cancel says so with the caller's reason, not as an ffmpeg failure.
    const stage = async (args: string[]): Promise<void> => {
      try {
        await runFfmpeg(args, { signal: stop.signal })
      } catch (err) {
        signal?.throwIfAborted()
        throw err
      }
    }
    const video = join(parts, 'video.mp4')
    await stage(['-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-y', video])
    const sound = join(parts, 'soundtrack.m4a')
    await stage(soundtrackArgs(takesFor(input.rawTimeline, input.narration), totalFrames, sound))
    // Muxed among the parts and moved into place, so a cancel during the mux leaves no half a file
    // where the finished one would be. Under a name of its own: the export's name, used here, was
    // the concat's own output when someone called their export video.mp4.
    const muxed = join(parts, `muxed${extname(outputPath)}`)
    await stage(['-v', 'error', '-i', video, '-i', sound, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', '-y', muxed])
    signal?.throwIfAborted()
    renameSync(muxed, outputPath)
  } finally {
    signal?.removeEventListener('abort', forward)
    stop.abort()
    await closeBrowser()
    closeReaders(id)
    rmSync(parts, { recursive: true, force: true })
  }
}

/**
 * Until the encoder can take more. Not `drain` alone: an encoder that has died never drains, and
 * a tab waiting on it would hold the whole export open.
 */
async function writable(encoder: RunningTool, signal: AbortSignal): Promise<void> {
  await Promise.race([
    once(encoder.process.stdin, 'drain', { signal }),
    encoder.done.then(() => {
      throw new Error('The encoder stopped before every frame was written')
    })
  ])
}

/**
 * Waited for until the process has gone, not until `done` settles: a spawn stopped by its signal
 * rejects `done` at once, on the abort, and a cancelled export returned with its encoders still
 * running. Killed outright, since a segment that is not finished is thrown away.
 */
async function stopEncoder(encoder: RunningTool): Promise<void> {
  const child = encoder.process
  child.stdin.destroy()
  // One that never started (no pid) never exits either.
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGKILL')
  await exited
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
  const crash = new AbortController()
  page.on('crash', () => crash.abort(new Error(`The export tab drawing frames ${range.from}–${range.to - 1} crashed`)))
  let encoder: RunningTool | null = null
  try {
    await page.goto(`${input.serverUrl}/__talkie/export/index.html`)
    await page.evaluate((given) => (window as unknown as { talkie: TalkiePage }).talkie.load(given), {
      timeline: input.timeline,
      theme: input.theme,
      fps: FPS,
      width: WIDTH,
      height: HEIGHT,
      durationInFrames: input.totalFrames,
      reader
    })
    const cdp = await page.context().newCDPSession(page)
    signal.throwIfAborted()
    // -framerate stamps the piped pictures at 30 a second; -r keeps the output at exactly that,
    // so the segment holds one frame per picture, no more and no fewer.
    encoder = spawnFfmpeg(
      ['-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', ...COLOUR, ...encode, '-r', String(FPS), '-an', '-y', segment],
      { signal }
    )
    // A cancel kills the encoder while the tab is still busy seeking; its failure is read below,
    // or in `finally`, but not before it happens, and an unread rejection is reported as unhandled.
    encoder.done.catch(() => undefined)
    for (let frame = range.from; frame < range.to; frame++) {
      signal.throwIfAborted()
      await raceAbort(page.evaluate((f) => (window as unknown as { talkie: TalkiePage }).talkie.seek(f), frame), crash.signal)
      // JPEG at 80: the quality the export was matched at, frame for frame, against the renderer it
      // replaced. Higher left saturated buttons and brand marks visibly different from the exports
      // people already had, where the 4:2:0 ringing on their edges changed.
      const { data } = await raceAbort(cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }), crash.signal)
      if (!encoder.process.stdin.write(Buffer.from(data, 'base64'))) await writable(encoder, signal)
      captured()
    }
    encoder.process.stdin.end()
    await encoder.done
  } finally {
    if (encoder) await stopEncoder(encoder)
    await page.close().catch(() => undefined)
  }
}
