import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject, addTimelineItem, addTranscriptSegment, readTranscript, readTimeline } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { narrateSegment } from './narrate'
import { updateSettings } from '../settings/settingsStore'

describe('narrateSegment (real say + afconvert)', () => {
  it('synthesizes real audio and extends the linked timeline item to fit', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-narrate-test-'))
    const project = createProject('Narrate Test', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/tmp/a.png' } }, baseDir)
    const segment = addTranscriptSegment(
      project.id,
      { text: 'This narration is definitely longer than one second of audio.', timelineItemId: item.id },
      baseDir
    )

    const result = await narrateSegment(project.id, segment.id, baseDir)

    expect(result.status).toBe('narrated')
    // Each take gets its own file so an earlier one is never overwritten.
    expect(result.audioFile).toMatch(new RegExp(`^${segment.id}-\\d+\\.wav$`))

    const dir = findProjectDir(project.id, baseDir) as string
    const audioPath = join(dir, 'audio', result.audioFile as string)
    expect(existsSync(audioPath)).toBe(true)
    expect(statSync(audioPath).size).toBeGreaterThan(1000)

    const updatedItem = readTimeline(project.id, baseDir).find((i) => i.id === item.id)
    expect(updatedItem?.duration).toBeGreaterThan(30)

    const updatedTranscript = readTranscript(project.id, baseDir)
    expect(updatedTranscript[0].status).toBe('narrated')

    rmSync(baseDir, { recursive: true, force: true })
  }, 30_000)

  it('never shortens a video item, so narrating cannot truncate the recording', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-narrate-video-test-'))
    const project = createProject('Narrate Video Test', baseDir)
    // A 20-second recording narrated with a short line: the clip must keep its own length.
    const item = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 600, data: { src: '/tmp/session/video.webm' } },
      baseDir
    )
    const segment = addTranscriptSegment(project.id, { text: 'Short line.', timelineItemId: item.id }, baseDir)

    await narrateSegment(project.id, segment.id, baseDir)

    const updatedItem = readTimeline(project.id, baseDir).find((i) => i.id === item.id)
    expect(updatedItem?.duration).toBe(600)

    rmSync(baseDir, { recursive: true, force: true })
  }, 30_000)

  it('extends a video item when the narration outlasts the recording', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-narrate-video-long-test-'))
    const project = createProject('Narrate Video Long Test', baseDir)
    const item = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 5, data: { src: '/tmp/session/video.webm' } },
      baseDir
    )
    const segment = addTranscriptSegment(
      project.id,
      { text: 'This narration is definitely longer than five frames of video.', timelineItemId: item.id },
      baseDir
    )

    await narrateSegment(project.id, segment.id, baseDir)

    const updatedItem = readTimeline(project.id, baseDir).find((i) => i.id === item.id)
    expect(updatedItem?.duration).toBeGreaterThan(5)

    rmSync(baseDir, { recursive: true, force: true })
  }, 30_000)
})

describe('voice', () => {
  it('records which voice read the narration', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-narrate-voice-test-'))
    process.env.HOME = baseDir
    updateSettings({ speech: { voice: 'Daniel' } }, baseDir)

    const project = createProject('Voice Test', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/tmp/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Reading in a chosen voice.', timelineItemId: item.id }, baseDir)

    const result = await narrateSegment(project.id, segment.id, baseDir)

    expect(result.voice).toBe('Daniel')
    rmSync(baseDir, { recursive: true, force: true })
  }, 30_000)

  it('re-narrating in a new voice replaces the recorded voice', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-renarrate-voice-test-'))
    process.env.HOME = baseDir
    updateSettings({ speech: { voice: 'Samantha' } }, baseDir)

    const project = createProject('Revoice Test', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/tmp/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Reading this line aloud.', timelineItemId: item.id }, baseDir)

    const first = await narrateSegment(project.id, segment.id, baseDir)
    updateSettings({ speech: { voice: 'Daniel' } }, baseDir)
    const second = await narrateSegment(project.id, segment.id, baseDir)

    expect(first.voice).toBe('Samantha')
    expect(second.voice).toBe('Daniel')
    // A new take is a new file, so the old recording is never overwritten.
    expect(second.audioFile).not.toBe(first.audioFile)
    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)
})
