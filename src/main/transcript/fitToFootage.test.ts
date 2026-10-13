import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg } from '../media'
import { createProject, addTimelineItem, addTranscriptSegment, readTimeline } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { narrateSegment } from './narrate'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { footageFrames, hurriedBy, readFaster, roomFor, MAX_SPEED_UP } from './fitToFootage'
import type { SpeechOptions } from '../tts/ttsProvider'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../remotion/constants'

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

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

/**
 * A silent clip of a known length, standing in for a recording.
 *
 * Built from a still rather than from `lavfi`: Remotion's bundled ffmpeg is a narrow build and
 * has no `color` source in it, and this has to be the same binary the app itself measures with.
 */
async function clipOf(seconds: number, path: string): Promise<void> {
  const still = `${path}.png`
  writeFileSync(still, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'))
  await runFfmpeg(['-loop', '1', '-framerate', '25', '-i', still, '-t', seconds.toFixed(3), '-c:v', 'libx264',
      '-vf', 'scale=320:180', '-pix_fmt', 'yuv420p', '-y', path])
  rmSync(still, { force: true })
}

/** An engine that honours a rate exactly, so the arithmetic can be checked without a voice. */
function obedientEngine(naturalSeconds: number, asked: SpeechOptions[]) {
  return async (_text: string, outputPath: string, options: SpeechOptions): Promise<void> => {
    asked.push(options)
    writeWav(outputPath, naturalSeconds / (options.pace / delivery.pace))
  }
}

describe('the delivery a hurried take is read at', () => {
  it('speeds the words and closes up the pauses by the same proportion', () => {
    const hurried = hurriedBy(delivery, 1.08)

    expect(hurried.pace).toBeCloseTo(170 * 1.08, 1)
    expect(hurried.sentencePauseMs).toBeLessThan(delivery.sentencePauseMs)
    expect(hurried.voice).toBe('Samantha')
  })

  it('never asks a voice to go faster than the settings allow', () => {
    expect(hurriedBy({ ...delivery, pace: 290 }, 1.14).pace).toBeLessThanOrEqual(300)
  })
})

describe('reading a little faster so the words land with the picture', () => {
  const footage = 10 * FPS
  const room = roomFor(footage)

  it('brings a take that overruns back inside its footage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'talkie-refit-'))
    const audioPath = join(dir, 'take.wav')
    const asked: SpeechOptions[] = []
    writeWav(audioPath, room * 1.08)

    const fitted = await readFaster({
      text: 'words',
      audioPath,
      spokenSeconds: room * 1.08,
      footageFrames: footage,
      delivery,
      synthesize: obedientEngine(room * 1.08, asked)
    })

    expect(fitted).not.toBeNull()
    expect(fitted!).toBeLessThanOrEqual(room)
    expect(asked[0].pace).toBeGreaterThan(delivery.pace)
    // The take on disk is the one that fits, not the one that did not.
    expect(getWavDurationSeconds(audioPath)).toBeCloseTo(fitted!, 1)

    rmSync(dir, { recursive: true, force: true })
  })

  it('leaves a take that already fits alone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'talkie-refit-fits-'))
    const audioPath = join(dir, 'take.wav')
    writeWav(audioPath, 3)

    expect(
      await readFaster({
        text: 'words',
        audioPath,
        spokenSeconds: 3,
        footageFrames: footage,
        delivery,
        synthesize: async () => {
          throw new Error('should not have been read again')
        }
      })
    ).toBeNull()

    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses to gabble, and leaves the take as it was read', async () => {
    // Past the limit the voice stops sounding like someone explaining, so the clip stretches
    // instead and the overrun is at least audible as a pause rather than hidden in the delivery.
    const dir = mkdtempSync(join(tmpdir(), 'talkie-refit-gabble-'))
    const audioPath = join(dir, 'take.wav')
    const tooLong = room * (MAX_SPEED_UP + 0.1)
    writeWav(audioPath, tooLong)

    const fitted = await readFaster({
      text: 'words',
      audioPath,
      spokenSeconds: tooLong,
      footageFrames: footage,
      delivery,
      synthesize: obedientEngine(tooLong, [])
    })

    expect(fitted).toBeNull()
    expect(getWavDurationSeconds(audioPath)).toBeCloseTo(tooLong, 1)

    rmSync(dir, { recursive: true, force: true })
  })

  it('corrects from what came back, because a voice treats a rate as a hint', async () => {
    // Samantha, asked for six per cent faster, returns a take half a per cent shorter. One open
    // guess at the rate is not enough, so each attempt is measured and the next one aims again.
    const dir = mkdtempSync(join(tmpdir(), 'talkie-refit-stubborn-'))
    const audioPath = join(dir, 'take.wav')
    const natural = room * 1.04
    const asked: SpeechOptions[] = []
    writeWav(audioPath, natural)

    const fitted = await readFaster({
      text: 'words',
      audioPath,
      spokenSeconds: natural,
      footageFrames: footage,
      delivery,
      // A voice that delivers only a third of the speed-up it is asked for.
      synthesize: async (_t, outputPath, options) => {
        asked.push(options)
        writeWav(outputPath, natural / (1 + ((options.pace / delivery.pace) - 1) * 0.35))
      }
    })

    expect(asked).toHaveLength(2)
    expect(asked[1].pace).toBeGreaterThan(asked[0].pace)
    expect(fitted!).toBeLessThanOrEqual(room)

    rmSync(dir, { recursive: true, force: true })
  })

  it('gives up on an engine that ignores the rate entirely', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'talkie-refit-deaf-'))
    const audioPath = join(dir, 'take.wav')
    const natural = room * 1.08
    let calls = 0
    writeWav(audioPath, natural)

    const fitted = await readFaster({
      text: 'words',
      audioPath,
      spokenSeconds: natural,
      footageFrames: footage,
      delivery,
      synthesize: async (_t, outputPath) => {
        calls += 1
        writeWav(outputPath, natural)
      }
    })

    expect(fitted).toBeNull()
    // Asked once, and not again once it was clear the answer would be the same.
    expect(calls).toBe(1)

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('how much picture a clip has behind it', () => {
  it('counts the recording, less what was trimmed off the front', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-footage-'))
    const project = createProject('Footage', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    const src = join(dir, 'sources', 'clip.mp4')
    await clipOf(8, src)

    const item = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 100, data: { src, trimBefore: 30 } },
      baseDir
    )

    // Eight seconds of recording, the first second of it dropped.
    expect(await footageFrames(item)).toBeCloseTo(8 * FPS - 30, -1)

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)

  it('has no answer for a slide, which is as long as it is asked to be', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-footage-scene-'))
    const project = createProject('Scene', baseDir)
    const item = addTimelineItem(
      project.id,
      { kind: 'scene', start: 0, duration: 100, data: { title: 'A slide' } },
      baseDir
    )

    expect(await footageFrames(item)).toBeNull()

    rmSync(baseDir, { recursive: true, force: true })
  })
})

describe('narrating a clip whose words run long', () => {
  it('keeps the voice inside the recording rather than stretching past its last frame', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-fit-narrate-'))
    const project = createProject('Fit', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    const src = join(dir, 'sources', 'clip.mp4')

    // Words first, so the clip can be made a touch too short for them on purpose.
    const text =
      'This is a stock analysis agent that runs on your own machine, and the watchlist is where ' +
      'it lives. Every position you are tracking sits here with a live price beside it.'
    const probe = join(dir, 'audio', 'probe.wav')
    await clipOf(1, src)
    const probeItem = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: probe } }, baseDir)
    const probeSegment = addTranscriptSegment(project.id, { text, timelineItemId: probeItem.id }, baseDir)
    const probed = await narrateSegment(project.id, probeSegment.id, baseDir)
    const naturalSeconds = getWavDurationSeconds(join(dir, 'audio', probed.audioFile as string))

    // A recording six per cent shorter than the words need: within what a faster read can absorb.
    const footageSeconds = (naturalSeconds / 1.06) + (NARRATION_LEAD_IN_FRAMES + NARRATION_TAIL_FRAMES) / FPS
    await clipOf(footageSeconds, src)

    const item = addTimelineItem(
      project.id,
      { kind: 'video', start: 30, duration: Math.round(footageSeconds * FPS), data: { src } },
      baseDir
    )
    const segment = addTranscriptSegment(project.id, { text, timelineItemId: item.id }, baseDir)
    const result = await narrateSegment(project.id, segment.id, baseDir)

    const fittedSeconds = getWavDurationSeconds(join(dir, 'audio', result.audioFile as string))
    expect(fittedSeconds).toBeLessThan(naturalSeconds)

    // The clip is still the length of its own footage: nothing was stretched past the picture.
    const finalItem = readTimeline(project.id, baseDir).find((i) => i.id === item.id)!
    expect(finalItem.duration).toBeLessThanOrEqual(Math.round(footageSeconds * FPS) + 1)

    // And the speech still finishes inside it.
    const speechEnds = NARRATION_LEAD_IN_FRAMES + Math.round(fittedSeconds * FPS)
    expect(speechEnds).toBeLessThanOrEqual(finalItem.duration)

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)
})
