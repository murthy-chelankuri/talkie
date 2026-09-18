import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readTimedTake } from './readTimedTake'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { roomFor, MAX_SPEED_UP } from './fitToFootage'
import { FPS } from '../../remotion/constants'
import type { SpeechOptions } from '../tts/ttsProvider'

const delivery: SpeechOptions = { voice: 'Samantha', pace: 170, sentencePauseMs: 420, clausePauseMs: 300 }

/** A wav header describing this many seconds of silence, which is all the fitting reads. */
function writeWav(path: string, seconds: number): void {
  const rate = 22_050
  const bytes = Math.round(seconds * rate * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + bytes, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(bytes, 40)
  writeFileSync(path, Buffer.concat([header, Buffer.alloc(bytes)]))
}

/**
 * A voice that takes a fixed time per beat at the project's own pace and honours a request to
 * go faster exactly. Real engines only approximate that, which is why the code measures.
 */
function voiceReading(secondsPerBeat: number, options: { obeys?: boolean } = {}) {
  const asked: number[] = []
  const synthesize = async (_text: string, outputPath: string, speech: SpeechOptions) => {
    const speedUp = speech.pace / delivery.pace
    asked.push(speedUp)
    writeWav(outputPath, secondsPerBeat / (options.obeys === false ? 1 : speedUp))
  }
  return { synthesize, asked }
}

describe('reading a take that is timed to the picture', () => {
  it('leaves the waits between beats where the recording put them', async () => {
    // The whole point of beats: a screen that sits for a while should be talked over at the
    // moments things happen, not at a steady rate.
    const dir = mkdtempSync(join(tmpdir(), 'talkie-timed-take-'))
    const audioPath = join(dir, 'take.wav')
    const voice = voiceReading(1)

    const seconds = await readTimedTake({
      beats: [
        { at: 0, text: 'first' },
        { at: 10, text: 'second' }
      ],
      audioPath,
      footageFrames: 20 * FPS,
      delivery,
      synthesize: voice.synthesize
    })

    // Two seconds of speech spread across ten, so the silence between them is real.
    expect(seconds).toBeGreaterThan(10)
    expect(getWavDurationSeconds(audioPath)).toBeCloseTo(seconds, 1)
    expect(voice.asked).toEqual([1, 1])

    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the take again faster when it would otherwise land after the picture', async () => {
    // A take that overruns used to be left overrunning: placeBeats can shorten the waiting, but
    // the words themselves take as long as they take, and every later sentence then described a
    // thing that had already happened.
    const dir = mkdtempSync(join(tmpdir(), 'talkie-timed-catch-up-'))
    const audioPath = join(dir, 'take.wav')
    const footage = 15 * FPS
    // Four beats of three and a half seconds against a room of about thirteen.
    const voice = voiceReading(3.5)

    const seconds = await readTimedTake({
      beats: [
        { at: 0, text: 'one' },
        { at: 3, text: 'two' },
        { at: 6, text: 'three' },
        { at: 9, text: 'four' }
      ],
      audioPath,
      footageFrames: footage,
      delivery,
      synthesize: voice.synthesize
    })

    expect(seconds).toBeLessThanOrEqual(roomFor(footage))
    // It asked for the second go at a faster pace than the first, and stayed within what a
    // listener would not notice.
    expect(voice.asked[voice.asked.length - 1]).toBeGreaterThan(1)
    expect(Math.max(...voice.asked)).toBeLessThanOrEqual(MAX_SPEED_UP)

    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps the best take it managed when no delivery would fit', async () => {
    // Beyond a tenth or so faster the voice stops sounding like someone explaining. A take that
    // long is too long by an amount no delivery can hide, so the scene's cut moves instead — and
    // what must never happen is the segment being left with no audio at all.
    const dir = mkdtempSync(join(tmpdir(), 'talkie-timed-gabble-'))
    const audioPath = join(dir, 'take.wav')
    const voice = voiceReading(20)

    const seconds = await readTimedTake({
      beats: [
        { at: 0, text: 'one' },
        { at: 1, text: 'two' }
      ],
      audioPath,
      footageFrames: 10 * FPS,
      delivery,
      synthesize: voice.synthesize
    })

    expect(seconds).toBeGreaterThan(roomFor(10 * FPS))
    expect(getWavDurationSeconds(audioPath)).toBeCloseTo(seconds, 1)
    expect(Math.max(...voice.asked)).toBeLessThanOrEqual(MAX_SPEED_UP)

    rmSync(dir, { recursive: true, force: true })
  })

  it('does not leave a worse take behind when the voice ignores the faster pace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'talkie-timed-stubborn-'))
    const audioPath = join(dir, 'take.wav')
    const voice = voiceReading(6, { obeys: false })

    const seconds = await readTimedTake({
      beats: [
        { at: 0, text: 'one' },
        { at: 2, text: 'two' }
      ],
      audioPath,
      footageFrames: 13 * FPS,
      delivery,
      synthesize: voice.synthesize
    })

    // It did try, and the take it kept is still the one on disk rather than a half-written one.
    expect(voice.asked.length).toBeGreaterThan(2)
    expect(getWavDurationSeconds(audioPath)).toBeCloseTo(seconds, 1)

    rmSync(dir, { recursive: true, force: true })
  })

  it('lets a slide take as long as it needs, having no footage to keep up with', async () => {
    // A slide grows to hold whatever is said over it, so there is nothing to hurry for and the
    // waits written into the take have to survive intact.
    const dir = mkdtempSync(join(tmpdir(), 'talkie-timed-slide-'))
    const audioPath = join(dir, 'take.wav')
    const voice = voiceReading(4)

    const seconds = await readTimedTake({
      beats: [
        { at: 0, text: 'one' },
        { at: 30, text: 'two' }
      ],
      audioPath,
      footageFrames: null,
      delivery,
      synthesize: voice.synthesize
    })

    expect(voice.asked).toEqual([1, 1])
    // The second beat still waits for its moment rather than following straight on.
    expect(seconds).toBeGreaterThan(30)

    rmSync(dir, { recursive: true, force: true })
  })
})
