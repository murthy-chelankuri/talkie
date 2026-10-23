import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createProject,
  addTimelineItem,
  addTranscriptSegment,
  readTranscript,
  readTimeline,
  setProjectVoice,
  setProjectContext
} from '../project/projectApi'
import { EMPTY_CONTEXT } from '../project/projectContext'
import { kokoroTtsProvider } from '../tts/kokoroTtsProvider'
import { isKokoroDownloaded } from '../tts/kokoro/kokoroModel'
import { findProjectDir } from '../project/paths'
import { narrateSegment } from './narrate'
import { updateSettings } from '../settings/settingsStore'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../composition/constants'

// Kokoro reads the narration for real; where its voice has not been downloaded there is nothing
// to read with, so these skip rather than fail. Two voices stand in for "the app's" and "the
// project's": af_heart, the default, and bm_george, plainly a different one.
const downloaded = isKokoroDownloaded()

describe.skipIf(!downloaded)('narrateSegment (real Kokoro)', () => {
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
  }, 90_000)

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
  }, 90_000)

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
  }, 90_000)
})

/**
 * These speak for real, through Kokoro, which has to load its model before it will say anything —
 * a cost measured in seconds, not of the code but of the machine. Ninety gives it room to be slow
 * without giving a hang anywhere to hide.
 */
describe.skipIf(!downloaded)('voice', () => {
  it('records which voice read the narration', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-narrate-voice-test-'))
    updateSettings({ speech: { voice: 'bm_george' } }, baseDir)

    const project = createProject('Voice Test', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/tmp/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Reading in a chosen voice.', timelineItemId: item.id }, baseDir)

    const result = await narrateSegment(project.id, segment.id, baseDir)

    expect(result.voice).toBe('bm_george')
    rmSync(baseDir, { recursive: true, force: true })
  }, 90_000)

  it("uses the project's own voice ahead of the app's", async () => {
    // The point of pinning a voice to a project: new takes have to match the ones already in it,
    // or the mismatch this was meant to settle comes straight back.
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-project-voice-test-'))
    updateSettings({ speech: { voice: 'af_heart' } }, baseDir)

    const project = createProject('Own Voice', baseDir)
    setProjectVoice(project.id, 'bm_george', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: 'x.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'In the project voice.', timelineItemId: item.id }, baseDir)

    const result = await narrateSegment(project.id, segment.id, baseDir)

    expect(result.voice).toBe('bm_george')
    rmSync(baseDir, { recursive: true, force: true })
  }, 90_000)

  it('goes back to the app voice when the project keeps none', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-unpinned-voice-test-'))
    updateSettings({ speech: { voice: 'af_heart' } }, baseDir)

    const project = createProject('Unpinned', baseDir)
    setProjectVoice(project.id, 'bm_george', baseDir)
    setProjectVoice(project.id, null, baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: 'x.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Back to the default.', timelineItemId: item.id }, baseDir)

    expect((await narrateSegment(project.id, segment.id, baseDir)).voice).toBe('af_heart')
    rmSync(baseDir, { recursive: true, force: true })
  }, 90_000)

  it('re-narrating in a new voice replaces the recorded voice', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-renarrate-voice-test-'))
    updateSettings({ speech: { voice: 'af_heart' } }, baseDir)

    const project = createProject('Revoice Test', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/tmp/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Reading this line aloud.', timelineItemId: item.id }, baseDir)

    const first = await narrateSegment(project.id, segment.id, baseDir)
    updateSettings({ speech: { voice: 'bm_george' } }, baseDir)
    const second = await narrateSegment(project.id, segment.id, baseDir)

    expect(first.voice).toBe('af_heart')
    expect(second.voice).toBe('bm_george')
    // A new take is a new file, so the old recording is never overwritten.
    expect(second.audioFile).not.toBe(first.audioFile)
    rmSync(baseDir, { recursive: true, force: true })
  }, 90_000)
})

describe.skipIf(!downloaded)('pauses between clips', () => {
  it('makes the clip long enough to hold silence either side of the words', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-pause-test-'))
    const project = createProject('Pause Test', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/tmp/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'A line of narration to time.', timelineItemId: item.id }, baseDir)

    const result = await narrateSegment(project.id, segment.id, baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    const spokenFrames = Math.max(
      1,
      Math.round(getWavDurationSeconds(join(dir, 'audio', result.audioFile as string)) * FPS)
    )
    const duration = readTimeline(project.id, baseDir).find((i) => i.id === item.id)?.duration

    // Without the extra frames the next clip would cut in on the last word.
    expect(duration).toBe(spokenFrames + NARRATION_LEAD_IN_FRAMES + NARRATION_TAIL_FRAMES)
    rmSync(baseDir, { recursive: true, force: true })
  }, 90_000)

  it('still never shortens a recording to fit the pause', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-pause-video-test-'))
    const project = createProject('Pause Video', baseDir)
    const item = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 600, data: { src: '/tmp/session/video.webm' } },
      baseDir
    )
    const segment = addTranscriptSegment(project.id, { text: 'Short.', timelineItemId: item.id }, baseDir)

    await narrateSegment(project.id, segment.id, baseDir)

    expect(readTimeline(project.id, baseDir).find((i) => i.id === item.id)?.duration).toBe(600)
    rmSync(baseDir, { recursive: true, force: true })
  }, 90_000)
})

describe.skipIf(!downloaded)('pronunciation', () => {
  it('says a listed word the way it should be heard, and keeps the script as written', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-narrate-pronounce-test-'))
    const project = createProject('Pronounce Test', baseDir)
    setProjectContext(
      project.id,
      { ...EMPTY_CONTEXT, pronunciations: [{ written: 'SecOps', spoken: 'Seck-ops' }] },
      baseDir
    )
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/tmp/a.png' } }, baseDir)
    const segment = addTranscriptSegment(
      project.id,
      { text: 'SecOps flags the change.', timelineItemId: item.id },
      baseDir
    )
    const heard = vi.spyOn(kokoroTtsProvider, 'synthesize')

    try {
      await narrateSegment(project.id, segment.id, baseDir)

      expect(heard.mock.calls.map(([text]) => text).join(' ')).toContain('Seck-ops flags the change.')
      expect(readTranscript(project.id, baseDir)[0].text).toBe('SecOps flags the change.')
    } finally {
      heard.mockRestore()
      rmSync(baseDir, { recursive: true, force: true })
    }
  }, 90_000)
})
