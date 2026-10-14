import { probeMedia, spawnFfmpeg, type RunningTool } from '../../media'
import { FPS } from '../../../remotion/constants'

/**
 * Frames of recordings, for the export: one ffmpeg per tab per file, decoding forward from the
 * first frame asked for and handing frames out in order. Each tab exports consecutive frames,
 * so nearly every request is the decoder's next frame. One behind the decoder, or more than two
 * seconds ahead of it, starts it again there — cheaper than decoding the gap.
 */
const RESTART_AHEAD = FPS * 2

/**
 * How many decoded frames may wait unread. ffmpeg decodes far faster than a tab asks, and without
 * a limit a long recording would sit in memory as JPEGs; paused, the pipe fills and ffmpeg waits.
 */
const MAX_BUFFERED = 60

type Decoder = {
  file: string
  /** The frame the next JPEG off the pipe will be. */
  next: number
  frames: Buffer[]
  last: Buffer | null
  ended: boolean
  /** Why the decoder stopped, when it did not reach the end of the file cleanly. */
  error: Error | null
  waiting: (() => void) | null
  tool: RunningTool
}

const decoders = new Map<string, Decoder>()
/** Requests for one reader's file, one at a time, so a restart never pulls a decoder out from under a caller waiting on it. */
const queues = new Map<string, Promise<unknown>>()
const lastFrame = new Map<string, number>()
/** Each file's own frame rate, cached: frames are decoded at it and matched to composition frames by time. */
const rates = new Map<string, number>()
/** Each file's first timestamp, cached: a recording that opens at a later PTS shifts which frame a moment lands on. */
const startsAt = new Map<string, number>()
/** Decoders whose ffmpeg has not exited yet, for tests that check nothing is left running. */
const live = new Set<Decoder>()
/** Prefixes an export has closed: a request already in flight for one must not start a decoder nobody will stop. */
const closed = new Set<string>()
let started = 0

// A PNG ends with its IEND chunk: a zero-length chunk whose type and CRC are the constant bytes
// below, so the sequence marks the end of one picture in the stream and sits nowhere else.
const IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])

export function decodersStarted(): number {
  return started
}

export function liveDecoders(): number {
  return live.size
}

/**
 * Ends a decoder for good. Its stdout is destroyed first: paused with a full pipe, ffmpeg is
 * blocked in a write that a SIGTERM merely restarts, and Node never reads on to the end that
 * would let it exit — the process outlived the kill indefinitely.
 */
function stopDecoder(decoder: Decoder): void {
  decoder.tool.process.stdout.destroy()
  decoder.tool.process.kill()
}

/** A recording's own frame rate, cached. Unknown to ffprobe, it is taken as the composition's, so the match below is the identity it was before frames were matched by time. */
async function rateOf(file: string): Promise<number> {
  const known = rates.get(file)
  if (known !== undefined) return known
  const { fps } = await probeMedia(file)
  const rate = fps && fps > 0 ? fps : FPS
  rates.set(file, rate)
  return rate
}

/** A recording's first timestamp, cached. Playwright's recordings open at one frame in, not zero, which shifts every frame a moment lands on by one. */
async function startOf(file: string): Promise<number> {
  const known = startsAt.get(file)
  if (known !== undefined) return known
  const { startSeconds } = await probeMedia(file)
  startsAt.set(file, startSeconds)
  return startSeconds
}

async function finalFrame(file: string): Promise<number> {
  const known = lastFrame.get(file)
  if (known !== undefined) return known
  const { durationSeconds } = await probeMedia(file)
  // The last frame of the recording itself, at its own rate. A recording whose container states no
  // length is not clamped: the decoder simply runs out, and the last frame it made is the one held.
  const last = durationSeconds === null ? Infinity : Math.max(0, Math.floor(durationSeconds * (await rateOf(file))) - 1)
  lastFrame.set(file, last)
  return last
}

function start(file: string, from: number, rate: number, startSeconds: number): Decoder {
  started++
  // Decoded at the recording's own rate — one picture per source frame, matched to a composition
  // frame by time in serve() where the rates differ, as Remotion's frame server does rather than
  // resampling the stream. -ss alone is only keyframe-accurate here: seeking to a frame's own time
  // overshot it by one often enough to show a later picture through a mid-animation moment. So -ss
  // lands a couple of frames early for speed and -copyts keeps each frame's real timestamp, then
  // select hands on the first frame at `from`'s time or later — exact, whatever the seek did. PNG,
  // not JPEG: the browser is handed the exact pixels the recording holds, so the colour a saturated
  // brand loses to lossy chroma is kept — the step Remotion's frame server also omits.
  const seek = Math.max(0, startSeconds + (from - 2) / rate)
  const at = startSeconds + (from - 0.5) / rate
  const tool = spawnFfmpeg(['-v', 'error', '-ss', seek.toFixed(4), '-copyts', '-i', file, '-vf', `select=gte(t\\,${at.toFixed(6)})`, '-fps_mode', 'passthrough', '-f', 'image2pipe', '-c:v', 'png', '-compression_level', '1', 'pipe:1'])
  const decoder: Decoder = { file, next: from, frames: [], last: null, ended: false, error: null, waiting: null, tool }
  live.add(decoder)
  let pending = Buffer.alloc(0)
  tool.process.stdout.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk])
    for (let end = pending.indexOf(IEND); end !== -1; end = pending.indexOf(IEND)) {
      decoder.frames.push(pending.subarray(0, end + IEND.length))
      pending = pending.subarray(end + IEND.length)
    }
    if (decoder.frames.length >= MAX_BUFFERED) tool.process.stdout.pause()
    decoder.waiting?.()
  })
  const finish = (error: Error | null): void => {
    decoder.error = error
    decoder.ended = true
    live.delete(decoder)
    decoder.waiting?.()
  }
  tool.done.then(() => finish(null), (error: Error) => finish(error))
  return decoder
}

async function take(decoder: Decoder): Promise<Buffer | null> {
  while (decoder.frames.length === 0 && !decoder.ended) await new Promise<void>((resolve) => (decoder.waiting = resolve))
  decoder.waiting = null
  const frame = decoder.frames.shift() ?? null
  if (frame) {
    decoder.last = frame
    decoder.next++
    if (decoder.frames.length < MAX_BUFFERED / 2) decoder.tool.process.stdout.resume()
  }
  return frame
}

function isClosed(reader: string): boolean {
  for (const prefix of closed) if (reader.startsWith(`${prefix}-`)) return true
  return false
}

async function serve(reader: string, file: string, frame: number): Promise<Buffer> {
  const rate = await rateOf(file)
  const startSeconds = await startOf(file)
  // The composition frame asked for, as a source frame: the recording's frame showing at that
  // moment, floor from its own first timestamp as Remotion takes it, so a 25 fps recording that
  // opens a frame in, under a 30 fps composition, lands on the same picture both ways rather than
  // one frame off through a mid-animation moment.
  const wanted = Math.max(0, Math.min(Math.floor((frame / FPS - startSeconds) * rate), await finalFrame(file)))
  if (isClosed(reader)) throw new Error(`Reader ${reader} was closed`)
  const key = `${reader}\u0000${file}`
  let decoder = decoders.get(key)
  const behind = decoder && wanted < decoder.next - 1
  const tooFar = decoder && wanted > decoder.next + RESTART_AHEAD
  if (!decoder || behind || tooFar) {
    if (decoder) stopDecoder(decoder)
    decoder = start(file, wanted, rate, startSeconds)
    decoders.set(key, decoder)
  }
  // The frame handed out last time, asked for again (a held frame), is still the last one taken.
  if (wanted === decoder.next - 1 && decoder.last) return decoder.last
  while (decoder.next <= wanted) {
    const taken = await take(decoder)
    if (!taken) break
  }
  // Only a clean end of file holds the last frame; a decoder that failed would otherwise hand
  // out a frozen picture for the rest of the export.
  if (decoder.next <= wanted && decoder.error) throw decoder.error
  if (!decoder.last) throw new Error(`No frame ${wanted} in ${file}`)
  return decoder.last
}

export function footageFrame(reader: string, file: string, frame: number): Promise<Buffer> {
  const key = `${reader}\u0000${file}`
  const result = (queues.get(key) ?? Promise.resolve()).then(() => serve(reader, file, frame))
  const settled = result.catch(() => undefined)
  queues.set(key, settled)
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key)
  })
  return result
}

/** Stops every decoder an export's tabs started. Their readers all begin `<export id>-`. */
export function closeReaders(prefix: string): void {
  closed.add(prefix)
  for (const [key, decoder] of decoders) {
    if (key.startsWith(`${prefix}-`)) {
      stopDecoder(decoder)
      decoders.delete(key)
    }
  }
}
