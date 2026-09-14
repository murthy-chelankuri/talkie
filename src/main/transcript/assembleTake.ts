import { readFileSync, writeFileSync } from 'fs'
import { readWavFormat, type WavFormat } from '../tts/wavDuration'

/**
 * Join the pieces of a take into one file, with real silence between them.
 *
 * Narration used to be one unbroken stretch of speech laid over a clip, which meant it was only
 * ever in step with the picture at the moment it started. A recording does not run at a constant
 * rate of events: a screen waits sixteen seconds for an analysis to come back and then takes ten
 * clicks in eleven. Talking through the wait puts every later sentence ahead of the thing it
 * describes.
 *
 * Padding the gaps here rather than playing each piece separately keeps one take per clip, so
 * the waveform in the timeline, the file on disk and the single `<Audio>` in the composition all
 * stay what they were — and the pauses are visible in the waveform, which is where someone
 * checking the timing would look.
 */
export interface Take {
  /** Seconds from the start of the take where these words should begin. */
  at: number
  wavPath: string
}

export interface AssembledTake {
  /** Where each piece actually landed, which is its own time or later — never earlier. */
  at: number[]
  seconds: number
}

/** Samples of silence, which for PCM is simply nothing. */
function silence(format: WavFormat, seconds: number): Buffer {
  const frames = Math.max(0, Math.round(seconds * format.sampleRate))
  return Buffer.alloc(frames * format.channels * (format.bitsPerSample / 8))
}

function dataChunk(path: string): Buffer {
  const buffer = readFileSync(path)
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'data') return buffer.subarray(offset + 8, Math.min(buffer.length, offset + 8 + size))
    offset += 8 + size + (size % 2)
  }
  throw new Error(`WAV file has no data chunk: ${path}`)
}

function header(format: WavFormat, dataBytes: number): Buffer {
  const bytesPerFrame = format.channels * (format.bitsPerSample / 8)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + dataBytes, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(format.channels, 22)
  head.writeUInt32LE(format.sampleRate, 24)
  head.writeUInt32LE(format.sampleRate * bytesPerFrame, 28)
  head.writeUInt16LE(bytesPerFrame, 32)
  head.writeUInt16LE(format.bitsPerSample, 34)
  head.write('data', 36)
  head.writeUInt32LE(dataBytes, 40)
  return head
}

/**
 * A piece never starts before the one in front of it has finished: a demo that overruns its own
 * commentary is a scheduling problem, not something to solve by talking over yourself. Where two
 * pieces collide the later one simply follows on, and the take runs longer than asked.
 */
export function assembleTake(pieces: Take[], outputPath: string): AssembledTake {
  if (pieces.length === 0) throw new Error('A take needs at least one piece')

  // Every piece comes from the same engine in the same run, so the first one's format is the
  // format — mixing rates here would mean resampling, and there is nothing to resample.
  const format = readWavFormat(pieces[0].wavPath)
  const bytesPerSecond = format.sampleRate * format.channels * (format.bitsPerSample / 8)

  const chunks: Buffer[] = []
  const at: number[] = []
  let cursor = 0

  for (const piece of pieces) {
    const startsAt = Math.max(piece.at, cursor)
    chunks.push(silence(format, startsAt - cursor))

    const data = dataChunk(piece.wavPath)
    chunks.push(data)
    at.push(startsAt)
    cursor = startsAt + data.length / bytesPerSecond
  }

  const body = Buffer.concat(chunks)
  writeFileSync(outputPath, Buffer.concat([header(format, body.length), body]))

  return { at, seconds: cursor }
}
