import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createProject,
  addTimelineItem,
  addTranscriptSegment,
  updateTranscriptSegmentAudio,
  readTimeline
} from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { repairNarrationDurations } from './repairNarrationDurations'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../composition/constants'

/** A valid 16-bit mono WAV of the given length, so duration can be measured for real. */
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

describe('repairNarrationDurations', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-duration-repair-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  function narratedClip(kind: string, durationFrames: number, audioSeconds: number) {
    const project = createProject('Repair', baseDir)
    const item = addTimelineItem(
      project.id,
      { kind, start: 0, duration: durationFrames, data: { src: '/a.png' } },
      baseDir
    )
    const segment = addTranscriptSegment(project.id, { text: 'Words', timelineItemId: item.id }, baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    mkdirSync(join(dir, 'audio'), { recursive: true })
    writeWav(join(dir, 'audio', 'take.wav'), audioSeconds)
    updateTranscriptSegmentAudio(project.id, segment.id, 'take.wav', 'Samantha', baseDir)

    return { project, item }
  }

  it('lengthens a clip that was sized to its audio alone', () => {
    // What narrating produced before the pauses existed: duration exactly the speech.
    const audioFrames = 3 * FPS
    const { project, item } = narratedClip('image', audioFrames, 3)

    expect(repairNarrationDurations(project.id, baseDir)).toBe(1)

    const repaired = readTimeline(project.id, baseDir).find((i) => i.id === item.id)
    expect(repaired?.duration).toBe(NARRATION_LEAD_IN_FRAMES + audioFrames + NARRATION_TAIL_FRAMES)
  })

  it('leaves room for the whole of the speech after the delay', () => {
    const audioFrames = 3 * FPS
    const { project, item } = narratedClip('image', audioFrames, 3)

    repairNarrationDurations(project.id, baseDir)

    const duration = readTimeline(project.id, baseDir).find((i) => i.id === item.id)?.duration as number
    // The last word has to land before the cut, not on it.
    expect(NARRATION_LEAD_IN_FRAMES + audioFrames).toBeLessThan(duration)
  })

  it('leaves a clip that is already long enough alone', () => {
    const { project, item } = narratedClip('image', 10 * FPS, 3)

    expect(repairNarrationDurations(project.id, baseDir)).toBe(0)
    expect(readTimeline(project.id, baseDir).find((i) => i.id === item.id)?.duration).toBe(10 * FPS)
  })

  it('never shortens a recording that outlasts its narration', () => {
    const { project, item } = narratedClip('video', 20 * FPS, 2)

    repairNarrationDurations(project.id, baseDir)

    expect(readTimeline(project.id, baseDir).find((i) => i.id === item.id)?.duration).toBe(20 * FPS)
  })

  it('closes the gap it opens, so clips still run back to back', () => {
    const project = createProject('Two', baseDir)
    const first = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const second = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 90, data: { src: '/b.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Words', timelineItemId: first.id }, baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    mkdirSync(join(dir, 'audio'), { recursive: true })
    writeWav(join(dir, 'audio', 'take.wav'), 3)
    updateTranscriptSegmentAudio(project.id, segment.id, 'take.wav', 'Samantha', baseDir)

    repairNarrationDurations(project.id, baseDir)

    const timeline = readTimeline(project.id, baseDir)
    const a = timeline.find((i) => i.id === first.id) as { start: number; duration: number }
    const b = timeline.find((i) => i.id === second.id) as { start: number }
    expect(b.start).toBe(a.start + a.duration)
  })

  it('ignores a clip with no narration', () => {
    const project = createProject('Silent', baseDir)
    addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/a.png' } }, baseDir)

    expect(repairNarrationDurations(project.id, baseDir)).toBe(0)
  })

  it('ignores narration whose audio file has gone', () => {
    const project = createProject('Missing', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Words', timelineItemId: item.id }, baseDir)
    updateTranscriptSegmentAudio(project.id, segment.id, 'gone.wav', 'Samantha', baseDir)

    expect(repairNarrationDurations(project.id, baseDir)).toBe(0)
  })

  it('is safe to run twice', () => {
    const { project, item } = narratedClip('image', 3 * FPS, 3)

    repairNarrationDurations(project.id, baseDir)
    const after = readTimeline(project.id, baseDir).find((i) => i.id === item.id)?.duration

    expect(repairNarrationDurations(project.id, baseDir)).toBe(0)
    expect(readTimeline(project.id, baseDir).find((i) => i.id === item.id)?.duration).toBe(after)
  })

  it('does nothing for a project that does not exist', () => {
    expect(repairNarrationDurations('nope', baseDir)).toBe(0)
  })
})
