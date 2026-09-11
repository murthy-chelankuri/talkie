import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createProject,
  addTimelineItem,
  importImage,
  readTimeline,
  reorderTimelineItems,
  splitTimelineItem,
  deleteTimelineItem,
  updateTimelineItemDuration,
  addTranscriptSegment,
  updateTranscriptSegmentAudio
} from './projectApi'
import { findProjectDir } from './paths'
import { saveSlides } from '../slides/importSlides'
import { repairNarrationDurations } from '../transcript/repairNarrationDurations'
import { FPS } from '../../remotion/constants'

/**
 * The timeline is played back by laying clips end to end, so a gap plays as a frozen frame and
 * an overlap plays two clips at once. Every operation that changes a clip's length or order has
 * to re-derive the ones after it, and that has been got wrong before — so rather than testing
 * each operation's arithmetic, this asserts the property they all have to preserve.
 */
function assertClipsRunBackToBack(projectId: string, baseDir: string): void {
  const timeline = readTimeline(projectId, baseDir)

  let expected = 0
  for (const [index, item] of timeline.entries()) {
    expect(item.start, `clip ${index} starts at ${item.start}, expected ${expected}`).toBe(expected)
    expect(item.duration, `clip ${index} has no length`).toBeGreaterThan(0)
    expected += item.duration
  }
}

describe('the timeline always runs back to back', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-invariants-'))
    process.env.HOME = baseDir
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  /**
   * Built the way the app builds one: each clip appended at the end of the last. addTimelineItem
   * stores whatever start it is given, so it is the callers that keep the timeline contiguous.
   */
  function threeClips() {
    const project = createProject('Invariants', baseDir)
    const ids: ReturnType<typeof addTimelineItem>[] = []
    let start = 0
    for (const [index, duration] of [90, 120, 60].entries()) {
      ids.push(
        addTimelineItem(project.id, { kind: 'image', start, duration, data: { src: `/${index}.png` } }, baseDir)
      )
      start += duration
    }
    return { project, ids }
  }

  it('when clips are added one after another', () => {
    const { project } = threeClips()

    assertClipsRunBackToBack(project.id, baseDir)
  })

  it('after a clip is made longer', () => {
    const { project, ids } = threeClips()

    updateTimelineItemDuration(project.id, ids[0].id, 300, baseDir)

    assertClipsRunBackToBack(project.id, baseDir)
  })

  it('after a clip is made shorter', () => {
    const { project, ids } = threeClips()

    updateTimelineItemDuration(project.id, ids[1].id, 15, baseDir)

    assertClipsRunBackToBack(project.id, baseDir)
  })

  it('after clips are reordered', () => {
    const { project, ids } = threeClips()

    reorderTimelineItems(project.id, [ids[2].id, ids[0].id, ids[1].id], baseDir)

    assertClipsRunBackToBack(project.id, baseDir)
  })

  it('after a clip is split', () => {
    const { project, ids } = threeClips()

    // Split points are absolute frames on the timeline, not offsets into the clip.
    splitTimelineItem(project.id, ids[1].id, ids[1].start + 40, baseDir)

    assertClipsRunBackToBack(project.id, baseDir)
  })

  it('after a clip is deleted from the middle', () => {
    const { project, ids } = threeClips()

    deleteTimelineItem(project.id, ids[1].id, baseDir)

    assertClipsRunBackToBack(project.id, baseDir)
  })

  it('after every clip is deleted', () => {
    const { project, ids } = threeClips()

    for (const item of ids) deleteTimelineItem(project.id, item.id, baseDir)

    expect(readTimeline(project.id, baseDir)).toEqual([])
  })

  it('after an image is imported onto a timeline that already has clips', () => {
    const { project } = threeClips()
    const source = join(baseDir, 'photo.png')
    writeFileSync(source, 'png-bytes')

    importImage(project.id, source, baseDir)

    assertClipsRunBackToBack(project.id, baseDir)
  })

  it('after a deck of slides is imported', () => {
    const { project } = threeClips()

    saveSlides(project.id, [{ png: new Uint8Array([1]) }, { png: new Uint8Array([2]) }], [], baseDir)

    assertClipsRunBackToBack(project.id, baseDir)
  })

  it('after clips are lengthened to fit their narration', () => {
    const { project, ids } = threeClips()
    const dir = findProjectDir(project.id, baseDir) as string
    mkdirSync(join(dir, 'audio'), { recursive: true })

    // Narration on the first clip, longer than the clip it sits on.
    const segment = addTranscriptSegment(project.id, { text: 'Words', timelineItemId: ids[0].id }, baseDir)
    writeWav(join(dir, 'audio', 'take.wav'), 6)
    updateTranscriptSegmentAudio(project.id, segment.id, 'take.wav', 'Samantha', baseDir)

    repairNarrationDurations(project.id, baseDir)

    assertClipsRunBackToBack(project.id, baseDir)
  })

  it('after a whole run of edits, not just one', () => {
    const { project, ids } = threeClips()

    updateTimelineItemDuration(project.id, ids[0].id, 240, baseDir)
    const third = readTimeline(project.id, baseDir)[2]
    splitTimelineItem(project.id, third.id, third.start + 30, baseDir)
    reorderTimelineItems(
      project.id,
      readTimeline(project.id, baseDir)
        .map((item) => item.id)
        .reverse(),
      baseDir
    )
    deleteTimelineItem(project.id, readTimeline(project.id, baseDir)[1].id, baseDir)
    saveSlides(project.id, [{ png: new Uint8Array([1]) }], [], baseDir)

    assertClipsRunBackToBack(project.id, baseDir)
  })

  it('keeps the total length equal to the sum of the clips', () => {
    const { project, ids } = threeClips()
    updateTimelineItemDuration(project.id, ids[0].id, 200, baseDir)

    const timeline = readTimeline(project.id, baseDir)
    const last = timeline[timeline.length - 1]

    expect(last.start + last.duration).toBe(timeline.reduce((total, item) => total + item.duration, 0))
  })

  it('never lets a clip be shorter than a single frame', () => {
    const { project, ids } = threeClips()

    expect(() => updateTimelineItemDuration(project.id, ids[0].id, 0, baseDir)).toThrow()
    expect(readTimeline(project.id, baseDir).every((item) => item.duration >= 1)).toBe(true)
  })
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
