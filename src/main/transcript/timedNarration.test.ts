import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseBeats, beatsToText, placeBeats } from './narrationBeats'
import { assembleTake } from './assembleTake'
import { readWavFormat, getWavDurationSeconds } from '../tts/wavDuration'
import {
  createProject,
  addTimelineItem,
  addTranscriptSegment,
  readTranscript,
  setDraftedNarration
} from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { narrateSegment } from './narrate'

/** A wav of this many seconds, at a level a silence detector would call sound. */
function tone(path: string, seconds: number): void {
  const rate = 22_050
  const frames = Math.round(seconds * rate)
  const body = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i += 1) body.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), i * 2)

  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + body.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(body.length, 40)
  writeFileSync(path, Buffer.concat([head, body]))
}

describe('reading the times out of a draft', () => {
  it('takes a line at a time, with the second it belongs to', () => {
    const beats = parseBeats('[0.0] This is the watchlist.\n[18.4] Adding one is typing a ticker.')

    expect(beats).toEqual([
      { at: 0, text: 'This is the watchlist.' },
      { at: 18.4, text: 'Adding one is typing a ticker.' }
    ])
  })

  it('joins a line the model wrapped onto the beat above it', () => {
    const beats = parseBeats('[2.0] A sentence that ran on\nand finished on the next line.\n[9.0] The next thing.')

    expect(beats[0].text).toBe('A sentence that ran on and finished on the next line.')
    expect(beats).toHaveLength(2)
  })

  it('never lets a beat be spoken before the one in front of it', () => {
    // An ordering slip is not a request to say two things at once.
    expect(parseBeats('[10] Second.\n[4] First.').map((beat) => beat.at)).toEqual([10, 10])
  })

  it('finds nothing in a draft with no timings, which is still good narration', () => {
    expect(parseBeats('This is perfectly ordinary narration. It just has no times on it.')).toEqual([])
  })

  it('reads the whole thing back as prose for the editor', () => {
    expect(beatsToText(parseBeats('[0] One thing.\n[5] Then another.'))).toBe('One thing. Then another.')
  })
})

describe('placing the beats in the clip', () => {
  const options = { leadInSeconds: 0.6, roomSeconds: 60 }

  it('waits for the moment each beat belongs to', () => {
    // The gap is the point: the screen is loading and there is nothing to say yet.
    expect(placeBeats(
      [{ at: 0, text: 'a' }, { at: 30, text: 'b' }],
      [4, 4],
      options
    )).toEqual([0.6, 30])
  })

  it('never starts a beat before the one in front of it has finished', () => {
    expect(placeBeats(
      [{ at: 0, text: 'a' }, { at: 2, text: 'b' }],
      [10, 4],
      options
    )).toEqual([0.6, 10.6])
  })

  it('shortens the waits in proportion rather than running past the footage', () => {
    // Ten seconds of words wanting fifty seconds of clip, in a clip that has thirty.
    const at = placeBeats(
      [{ at: 0, text: 'a' }, { at: 20, text: 'b' }, { at: 40, text: 'c' }],
      [3, 3, 4],
      { leadInSeconds: 0.6, roomSeconds: 30 }
    )

    expect(at[at.length - 1] + 4).toBeLessThanOrEqual(30.01)
    // Still in order, and still with the waiting spread between them rather than all at the end.
    expect(at[1]).toBeGreaterThan(at[0] + 3)
    expect(at[2]).toBeGreaterThan(at[1] + 3)
  })
})

describe('a take assembled out of its beats', () => {
  it('pads the gaps with real silence so the words land on their moment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'talkie-assemble-'))
    tone(join(dir, 'a.wav'), 2)
    tone(join(dir, 'b.wav'), 3)
    const out = join(dir, 'take.wav')

    const assembled = assembleTake(
      [{ at: 0, wavPath: join(dir, 'a.wav') }, { at: 10, wavPath: join(dir, 'b.wav') }],
      out
    )

    expect(assembled.at).toEqual([0, 10])
    expect(assembled.seconds).toBeCloseTo(13, 2)
    expect(getWavDurationSeconds(out)).toBeCloseTo(13, 2)
    // The same voice it was read in.
    expect(readWavFormat(out).sampleRate).toBe(22_050)

    rmSync(dir, { recursive: true, force: true })
  })

  it('lets a piece that would overlap the one before it follow on instead', () => {
    const dir = mkdtempSync(join(tmpdir(), 'talkie-assemble-overlap-'))
    tone(join(dir, 'a.wav'), 5)
    tone(join(dir, 'b.wav'), 2)

    const assembled = assembleTake(
      [{ at: 0, wavPath: join(dir, 'a.wav') }, { at: 2, wavPath: join(dir, 'b.wav') }],
      join(dir, 'take.wav')
    )

    // Talking over yourself is never the answer; the second piece waits its turn.
    expect(assembled.at).toEqual([0, 5])
    expect(assembled.seconds).toBeCloseTo(7, 2)

    rmSync(dir, { recursive: true, force: true })
  })

  it('is silent where the screen is waiting', () => {
    const dir = mkdtempSync(join(tmpdir(), 'talkie-assemble-silence-'))
    tone(join(dir, 'a.wav'), 1)
    tone(join(dir, 'b.wav'), 1)
    const out = join(dir, 'take.wav')
    assembleTake([{ at: 0, wavPath: join(dir, 'a.wav') }, { at: 8, wavPath: join(dir, 'b.wav') }], out)

    const samples = readFileSync(out).subarray(44)
    const at = (seconds: number): number => Math.abs(samples.readInt16LE(Math.round(seconds * 22_050) * 2))

    expect(at(0.5)).toBeGreaterThan(0)
    expect(at(4)).toBe(0)
    expect(at(8.5)).toBeGreaterThan(0)

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('narrating a clip whose screen waits', () => {
  it('leaves the voice silent through the wait and speaks again on the other side', async () => {
    // The failure this exists for: a recording sat sixteen seconds waiting for an analysis while
    // the narration talked straight through it, putting every later sentence ahead of its
    // moment. Written in real audio because the silence has to actually be in the file.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-timed-narrate-'))
    const project = createProject('Timed', baseDir)
    const item = addTimelineItem(
      project.id,
      { kind: 'image', start: 0, duration: 60 * 30, data: { src: '/tmp/none.png' } },
      baseDir
    )
    addTranscriptSegment(project.id, { text: 'placeholder', timelineItemId: item.id }, baseDir)

    const beats = parseBeats('[0.0] Here is the watchlist.\n[30.0] And the analysis is back.')
    setDraftedNarration(project.id, item.id, beatsToText(beats), beats, baseDir)

    const segment = readTranscript(project.id, baseDir)[0]
    const result = await narrateSegment(project.id, segment.id, baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    const audioPath = join(dir, 'audio', result.audioFile as string)

    // The take reaches the second beat's moment rather than ending long before it.
    expect(getWavDurationSeconds(audioPath)).toBeGreaterThan(30)

    const format = readWavFormat(audioPath)
    const samples = readFileSync(audioPath).subarray(44)
    const loudAround = (seconds: number): number => {
      let peak = 0
      const from = Math.round((seconds - 0.4) * format.sampleRate)
      const to = Math.round((seconds + 0.4) * format.sampleRate)
      for (let i = from; i < to; i += 1) peak = Math.max(peak, Math.abs(samples.readInt16LE(i * 2)))
      return peak
    }

    expect(loudAround(1)).toBeGreaterThan(200)
    // The middle of the wait: nothing is happening on screen, so nothing is said.
    expect(loudAround(20)).toBe(0)
    expect(loudAround(30.2)).toBeGreaterThan(200)

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)
})
