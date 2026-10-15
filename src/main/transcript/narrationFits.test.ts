import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createProject,
  addTimelineItem,
  addTranscriptSegment,
  readTimeline,
  readTranscript,
  updateTranscriptSegmentAudio
} from '../project/projectApi'
import { runFfmpeg } from '../media'
import { findProjectDir } from '../project/paths'
import { narrateSegment } from './narrate'
import { saveRecordedNarration } from './recordNarration'
import { repairNarrationDurations } from './repairNarrationDurations'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../composition/constants'

/**
 * The regression that reached the user, written as the rule it broke.
 *
 * Narration does not start when its clip does — it is held back a beat — so a clip must be
 * longer than its audio by at least that much or the composition plays speech past the cut and
 * the next clip swallows the end of the sentence. Every route that attaches audio to a clip has
 * to leave that room, so each is checked here rather than only where it was first fixed.
 */
function assertNarrationFits(projectId: string, baseDir: string): void {
  const dir = findProjectDir(projectId, baseDir) as string
  const timeline = readTimeline(projectId, baseDir)

  for (const segment of readTranscript(projectId, baseDir)) {
    if (!segment.audioFile) continue
    const item = timeline.find((candidate) => candidate.id === segment.timelineItemId)
    if (!item) continue

    const audioFrames = Math.round(getWavDurationSeconds(join(dir, 'audio', segment.audioFile)) * FPS)
    const speechEndsAt = NARRATION_LEAD_IN_FRAMES + audioFrames

    expect(
      speechEndsAt,
      `clip ${item.id} (${item.kind}) is ${item.duration} frames but its narration is still ` +
        `speaking at frame ${speechEndsAt}`
    ).toBeLessThanOrEqual(item.duration)
  }
}

async function webmTake(seconds: number): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-take-'))
  const path = join(dir, 'take.webm')
  await runFfmpeg(['-f', 'lavfi', '-i', `sine=frequency=200:duration=${seconds}`, '-c:a', 'libopus', '-y', path])
  const { readFileSync } = await import('fs')
  const bytes = new Uint8Array(readFileSync(path))
  rmSync(dir, { recursive: true, force: true })
  return bytes
}

describe('narration always fits inside its clip', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-fits-'))
    process.env.HOME = baseDir
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  function clip(kind: string, duration: number, text: string) {
    const project = createProject('Fits', baseDir)
    const item = addTimelineItem(project.id, { kind, start: 0, duration, data: { src: '/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text, timelineItemId: item.id }, baseDir)
    return { project, item, segment }
  }

  it('after synthesising a short line', async () => {
    const { project, segment } = clip('image', 30, 'Short.')

    await narrateSegment(project.id, segment.id, baseDir)

    assertNarrationFits(project.id, baseDir)
  }, 90_000)

  it('after synthesising a line far longer than the clip started out', async () => {
    const { project, segment } = clip(
      'image',
      5,
      'This narration runs on considerably longer than the clip it was attached to ever did.'
    )

    await narrateSegment(project.id, segment.id, baseDir)

    assertNarrationFits(project.id, baseDir)
  }, 90_000)

  it('after synthesising over a recording that outlasts the words', async () => {
    const { project, segment } = clip('video', 600, 'Short line over a long recording.')

    await narrateSegment(project.id, segment.id, baseDir)

    assertNarrationFits(project.id, baseDir)
  }, 90_000)

  it('after recording a take in the user\'s own voice', async () => {
    const { project, segment } = clip('image', 30, 'The script.')

    await saveRecordedNarration(project.id, segment.id, await webmTake(3), baseDir)

    assertNarrationFits(project.id, baseDir)
  }, 60_000)

  it('after a take is recorded over a clip that already had synthesised narration', async () => {
    const { project, segment } = clip('image', 30, 'The script.')
    await narrateSegment(project.id, segment.id, baseDir)

    await saveRecordedNarration(project.id, segment.id, await webmTake(4), baseDir)

    assertNarrationFits(project.id, baseDir)
  }, 60_000)

  it('after opening a project narrated before clips held any pause', () => {
    // Exactly the state the regression was found in: duration equal to the audio alone.
    const { project, item, segment } = clip('image', 30, 'Words')
    const dir = findProjectDir(project.id, baseDir) as string
    mkdirSync(join(dir, 'audio'), { recursive: true })
    writeWav(join(dir, 'audio', 'old.wav'), 4)
    updateTranscriptSegmentAudio(project.id, segment.id, 'old.wav', 'Samantha', baseDir)
    // The old rule: the clip is exactly as long as its audio.
    const audioFrames = 4 * FPS
    expect(readTimeline(project.id, baseDir).find((i) => i.id === item.id)).toBeDefined()

    repairNarrationDurations(project.id, baseDir)

    assertNarrationFits(project.id, baseDir)
    expect(readTimeline(project.id, baseDir).find((i) => i.id === item.id)?.duration).toBe(
      NARRATION_LEAD_IN_FRAMES + audioFrames + NARRATION_TAIL_FRAMES
    )
  })

  it('leaves the tail of silence the pause was added for', async () => {
    const { project, item, segment } = clip('image', 30, 'A line to time.')

    const saved = await narrateSegment(project.id, segment.id, baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    const audioFrames = Math.round(getWavDurationSeconds(join(dir, 'audio', saved.audioFile as string)) * FPS)
    const duration = readTimeline(project.id, baseDir).find((i) => i.id === item.id)?.duration as number

    expect(duration - (NARRATION_LEAD_IN_FRAMES + audioFrames)).toBe(NARRATION_TAIL_FRAMES)
  }, 90_000)
})

/** A real 16-bit mono WAV of a given length. */
function writeWav(path: string, seconds: number, sampleRate = 22050): void {
  const samples = Math.floor(seconds * sampleRate)
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  writeFileSync(path, buffer)
}
