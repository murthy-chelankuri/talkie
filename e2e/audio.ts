import { readFileSync } from 'fs'

/** Loud enough to be a voice rather than dither, over a 50ms window. */
const SPEECH_RMS = 0.01
const WINDOW_SECONDS = 0.05

export type TakeShape = {
  seconds: number
  /** How long before anything is said. */
  leadingSilence: number
  /** The longest stretch of nothing anywhere in the take. */
  longestSilence: number
  /** How loud it is overall, 0 to 1. Speech is well above 0.01; silence is 0. */
  rms: number
}

/**
 * The shape of a narration take: how long it is and where the silences are.
 *
 * A take that exists and has the right length can still be wrong — Kokoro once returned the
 * first sentence as five seconds of zeros, and every check that only asked "is there a file"
 * passed. What a listener would notice is a long silence, so that is what is measured.
 *
 * Reads the chunks rather than assuming a 44-byte header: the takes Talkie keeps have been
 * through ffmpeg, which writes a LIST chunk before the samples.
 */
export function takeShape(path: string): TakeShape {
  const wav = readFileSync(path)
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path} is not a WAV file`)
  }

  let offset = 12
  let channels = 1
  let sampleRate = 0
  let bits = 16
  let data: Buffer | null = null
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      channels = wav.readUInt16LE(body + 2)
      sampleRate = wav.readUInt32LE(body + 4)
      bits = wav.readUInt16LE(body + 14)
    } else if (id === 'data') {
      data = wav.subarray(body, Math.min(body + size, wav.length))
    }
    offset = body + size + (size % 2)
  }
  if (!data || !sampleRate || bits !== 16) throw new Error(`${path} is not 16-bit PCM`)

  const frames = Math.floor(data.length / (2 * channels))
  const window = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS))
  const loud: boolean[] = []
  let total = 0
  for (let start = 0; start < frames; start += window) {
    let sum = 0
    const end = Math.min(frames, start + window)
    for (let frame = start; frame < end; frame++) {
      const sample = data.readInt16LE(frame * 2 * channels) / 32768
      sum += sample * sample
    }
    total += sum
    loud.push(Math.sqrt(sum / (end - start)) > SPEECH_RMS)
  }

  const firstLoud = loud.indexOf(true)
  let longest = 0
  let run = 0
  for (const isLoud of loud) {
    run = isLoud ? 0 : run + 1
    longest = Math.max(longest, run)
  }
  return {
    seconds: frames / sampleRate,
    leadingSilence: (firstLoud === -1 ? loud.length : firstLoud) * WINDOW_SECONDS,
    longestSilence: longest * WINDOW_SECONDS,
    rms: frames === 0 ? 0 : Math.sqrt(total / frames)
  }
}
