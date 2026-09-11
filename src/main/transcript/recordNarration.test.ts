import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RenderInternals } from '@remotion/renderer'
import { createProject, addTimelineItem, addTranscriptSegment, readTimeline } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { saveRecordedNarration } from './recordNarration'
import { RECORDED_VOICE } from './schema'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../remotion/constants'

/** A real opus/webm clip, made the way the browser would deliver one. */
async function makeWebmRecording(seconds: number): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-webm-'))
  const path = join(dir, 'take.webm')
  await RenderInternals.callFf({
    bin: 'ffmpeg',
    args: [
      '-f', 'lavfi',
      '-i', `sine=frequency=220:duration=${seconds}`,
      '-c:a', 'libopus', '-b:a', '48k', '-y', path
    ],
    indent: false,
    logLevel: 'error',
    binariesDirectory: null,
    cancelSignal: undefined
  })
  const { readFileSync } = await import('fs')
  const bytes = new Uint8Array(readFileSync(path))
  rmSync(dir, { recursive: true, force: true })
  return bytes
}

describe('saveRecordedNarration', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-record-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  function clipWithScript(kind = 'image', duration = 30) {
    const project = createProject('Recorded', baseDir)
    const item = addTimelineItem(project.id, { kind, start: 0, duration, data: { src: '/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'The script I am reading.', timelineItemId: item.id }, baseDir)
    return { project, item, segment }
  }

  it('converts the browser recording into the WAV everything else expects', async () => {
    const { project, segment } = clipWithScript()

    const saved = await saveRecordedNarration(project.id, segment.id, await makeWebmRecording(2), baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    expect(saved.audioFile).toMatch(/\.wav$/)
    expect(existsSync(join(dir, 'audio', saved.audioFile as string))).toBe(true)
    expect(getWavDurationSeconds(join(dir, 'audio', saved.audioFile as string))).toBeCloseTo(2, 0)
  }, 60_000)

  it('marks the take as the user\'s own voice, not a synthesised one', async () => {
    const { project, segment } = clipWithScript()

    const saved = await saveRecordedNarration(project.id, segment.id, await makeWebmRecording(1), baseDir)

    expect(saved.voice).toBe(RECORDED_VOICE)
    expect(saved.status).toBe('narrated')
  }, 60_000)

  it('leaves the script alone, since it is what was being read from', async () => {
    const { project, segment } = clipWithScript()

    const saved = await saveRecordedNarration(project.id, segment.id, await makeWebmRecording(1), baseDir)

    expect(saved.text).toBe('The script I am reading.')
  }, 60_000)

  it('makes the clip long enough for the take and the pauses either side', async () => {
    const { project, item, segment } = clipWithScript()

    const saved = await saveRecordedNarration(project.id, segment.id, await makeWebmRecording(2), baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    const frames = Math.round(getWavDurationSeconds(join(dir, 'audio', saved.audioFile as string)) * FPS)
    const duration = readTimeline(project.id, baseDir).find((i) => i.id === item.id)?.duration
    expect(duration).toBe(NARRATION_LEAD_IN_FRAMES + frames + NARRATION_TAIL_FRAMES)
  }, 60_000)

  it('never shortens a recording that outlasts the take read over it', async () => {
    const { project, item, segment } = clipWithScript('video', 600)

    await saveRecordedNarration(project.id, segment.id, await makeWebmRecording(1), baseDir)

    expect(readTimeline(project.id, baseDir).find((i) => i.id === item.id)?.duration).toBe(600)
  }, 60_000)

  it('keeps the earlier take on disk, so undo still has something to go back to', async () => {
    const { project, segment } = clipWithScript()

    const first = await saveRecordedNarration(project.id, segment.id, await makeWebmRecording(1), baseDir)
    const second = await saveRecordedNarration(project.id, segment.id, await makeWebmRecording(2), baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    expect(second.audioFile).not.toBe(first.audioFile)
    expect(existsSync(join(dir, 'audio', first.audioFile as string))).toBe(true)
  }, 90_000)

  it('leaves no webm behind once it has been converted', async () => {
    const { project, segment } = clipWithScript()

    await saveRecordedNarration(project.id, segment.id, await makeWebmRecording(1), baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    expect(readdirSync(join(dir, 'audio')).filter((f) => f.endsWith('.webm'))).toEqual([])
  }, 60_000)

  it('refuses a segment that is not there', async () => {
    const project = createProject('Empty', baseDir)

    await expect(saveRecordedNarration(project.id, 'nope', await makeWebmRecording(1), baseDir)).rejects.toThrow(
      'No transcript segment found with id nope'
    )
  }, 60_000)
})
