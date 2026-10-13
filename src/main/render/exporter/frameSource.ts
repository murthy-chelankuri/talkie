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
  waiting: (() => void) | null
  tool: RunningTool
}

const decoders = new Map<string, Decoder>()
/** Requests for one reader's file, one at a time, so a restart never pulls a decoder out from under a caller waiting on it. */
const queues = new Map<string, Promise<unknown>>()
const lastFrame = new Map<string, number>()
let started = 0

const EOI = Buffer.from([0xff, 0xd9])

export function decodersStarted(): number {
  return started
}

async function finalFrame(file: string): Promise<number> {
  const known = lastFrame.get(file)
  if (known !== undefined) return known
  const { durationSeconds } = await probeMedia(file)
  // A recording whose container states no length is not clamped: the decoder simply runs out,
  // and the last frame it made is the one held.
  const last = durationSeconds === null ? Infinity : Math.max(0, Math.floor(durationSeconds * FPS) - 1)
  lastFrame.set(file, last)
  return last
}

function start(file: string, from: number): Decoder {
  started++
  // -ss before -i seeks to the nearest keyframe and decodes on to the exact moment; fps= then
  // gives one picture per composition frame, whatever rate the recording was made at. The seek
  // is half a frame early: a frame stamped at exactly `from / FPS` is dropped as "before the
  // start" once that time is rounded up to four places, and the last frame of a file went missing.
  const tool = spawnFfmpeg(['-v', 'error', '-ss', (Math.max(0, from - 0.5) / FPS).toFixed(4), '-i', file, '-vf', `fps=${FPS}`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '2', 'pipe:1'])
  const decoder: Decoder = { file, next: from, frames: [], last: null, ended: false, waiting: null, tool }
  let pending = Buffer.alloc(0)
  tool.process.stdout.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk])
    // A JPEG ends at FF D9; inside one, a literal FF is always followed by 00, so that pair
    // marks the end of a frame and nothing else.
    for (let end = pending.indexOf(EOI); end !== -1; end = pending.indexOf(EOI)) {
      decoder.frames.push(pending.subarray(0, end + 2))
      pending = pending.subarray(end + 2)
    }
    if (decoder.frames.length >= MAX_BUFFERED) tool.process.stdout.pause()
    decoder.waiting?.()
  })
  const finish = (): void => {
    decoder.ended = true
    decoder.waiting?.()
  }
  tool.done.then(finish, finish)
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

async function serve(reader: string, file: string, frame: number): Promise<Buffer> {
  const wanted = Math.min(frame, await finalFrame(file))
  const key = `${reader}\u0000${file}`
  let decoder = decoders.get(key)
  const behind = decoder && wanted < decoder.next - 1
  const tooFar = decoder && wanted > decoder.next + RESTART_AHEAD
  if (!decoder || behind || tooFar) {
    decoder?.tool.process.kill()
    decoder = start(file, wanted)
    decoders.set(key, decoder)
  }
  // The frame handed out last time, asked for again (a held frame), is still the last one taken.
  if (wanted === decoder.next - 1 && decoder.last) return decoder.last
  while (decoder.next <= wanted) {
    const taken = await take(decoder)
    if (!taken) break
  }
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
  for (const [key, decoder] of decoders) {
    if (key.startsWith(`${prefix}-`)) {
      decoder.tool.process.kill()
      decoders.delete(key)
    }
  }
}
