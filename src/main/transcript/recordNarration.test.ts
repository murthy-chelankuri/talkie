import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg } from '../media'
import { createProject, addTimelineItem, addTranscriptSegment, readTimeline } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { saveRecordedNarration, setRecordingCleanUp } from './recordNarration'
import { updateTranscriptSegmentAudio } from '../project/projectApi'
import { updateSettings } from '../settings/settingsStore'
import { roomyTake, voiceOverRoom } from './testTakes'
import { RECORDED_VOICE } from './schema'
import { getWavDurationSeconds } from '../tts/wavDuration'
import { FPS, NARRATION_LEAD_IN_FRAMES, NARRATION_TAIL_FRAMES } from '../../composition/constants'

/** A real opus/webm clip, made the way the browser would deliver one. */
async function makeWebmRecording(seconds: number): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-webm-'))
  const path = join(dir, 'take.webm')
  await runFfmpeg([
      '-f', 'lavfi',
      '-i', `sine=frequency=220:duration=${seconds}`,
      '-c:a', 'libopus', '-b:a', '48k', '-y', path
    ])
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

describe('making a take sit alongside the synthesised clips', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-loudness-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  /** A take recorded far too quietly, as a real one from across the room would be. */
  async function makeQuietRecording(seconds: number, gain: string): Promise<Uint8Array> {
    const dir = mkdtempSync(join(tmpdir(), 'talkie-quiet-'))
    const path = join(dir, 'take.webm')
    await runFfmpeg([
        '-f', 'lavfi',
        '-i', `sine=frequency=180:duration=${seconds}`,
        '-af', `volume=${gain}`,
        '-c:a', 'libopus', '-b:a', '48k', '-y', path
      ])
    const { readFileSync } = await import('fs')
    const bytes = new Uint8Array(readFileSync(path))
    rmSync(dir, { recursive: true, force: true })
    return bytes
  }

  async function integratedLoudness(path: string): Promise<number> {
    const result = await runFfmpeg(['-i', path, '-af', 'loudnorm=print_format=summary', '-f', 'null', '-'])
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    return Number(output.match(/Input Integrated:\s*(-?[\d.]+)/)?.[1])
  }

  it('lifts a take recorded too quietly up to the level of the rest of the video', async () => {
    const project = createProject('Loud', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Script', timelineItemId: item.id }, baseDir)

    const saved = await saveRecordedNarration(project.id, segment.id, await makeQuietRecording(4, '0.05'), baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    const loudness = await integratedLoudness(join(dir, 'audio', saved.audioFile as string))
    // The synthesised narration in a real project measures -17.5 to -18.0 LUFS.
    expect(loudness).toBeGreaterThan(-19)
    expect(loudness).toBeLessThan(-16)
  }, 120_000)

  it('brings a take recorded too loudly down to the same level', async () => {
    const project = createProject('Loud2', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Script', timelineItemId: item.id }, baseDir)

    const saved = await saveRecordedNarration(project.id, segment.id, await makeQuietRecording(4, '1.0'), baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    const loudness = await integratedLoudness(join(dir, 'audio', saved.audioFile as string))
    expect(loudness).toBeGreaterThan(-19)
    expect(loudness).toBeLessThan(-16)
  }, 120_000)

  it('keeps the full bandwidth the microphone captured', async () => {
    const project = createProject('Rate', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Script', timelineItemId: item.id }, baseDir)

    const saved = await saveRecordedNarration(project.id, segment.id, await makeQuietRecording(2, '0.5'), baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    const { readFileSync } = await import('fs')
    const header = readFileSync(join(dir, 'audio', saved.audioFile as string))
    // Downsampling to the synthesiser's 22050 would throw away half the voice's bandwidth.
    expect(header.readUInt32LE(24)).toBe(48000)
  }, 120_000)
})

describe('cleaning up a take in your own voice', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-clean-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  function clip() {
    const project = createProject('Clean', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 30, data: { src: '/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Script', timelineItemId: item.id }, baseDir)
    return { project, segment, dir: findProjectDir(project.id, baseDir) as string }
  }

  it('takes the room out from between the words, and keeps the words', async () => {
    const { project, segment, dir } = clip()

    const saved = await saveRecordedNarration(project.id, segment.id, await roomyTake(0.04), baseDir)

    const before = await voiceOverRoom(join(dir, 'audio', saved.recording!.original))
    const after = await voiceOverRoom(join(dir, 'audio', saved.audioFile as string))
    // Measured at 12 dB or more across a quiet, a medium and a loud room when it was tuned.
    expect(after - before).toBeGreaterThan(8)
    expect(saved.recording?.cleaned).toBe(true)
  }, 120_000)

  it('keeps the recording as it was heard, beside the take', async () => {
    const { project, segment, dir } = clip()

    const saved = await saveRecordedNarration(project.id, segment.id, await roomyTake(), baseDir)

    expect(saved.recording?.original).toMatch(/\.original\.wav$/)
    expect(existsSync(join(dir, 'audio', saved.recording!.original))).toBe(true)
    expect(saved.recording?.original).not.toBe(saved.audioFile)
  }, 120_000)

  it('leaves the take as recorded when the setting is off', async () => {
    const { project, segment, dir } = clip()
    updateSettings({ speech: { cleanRecordings: false } }, baseDir)

    const saved = await saveRecordedNarration(project.id, segment.id, await roomyTake(0.04), baseDir)

    const before = await voiceOverRoom(join(dir, 'audio', saved.recording!.original))
    const after = await voiceOverRoom(join(dir, 'audio', saved.audioFile as string))
    expect(Math.abs(after - before)).toBeLessThan(3)
    expect(saved.recording?.cleaned).toBe(false)
  }, 120_000)

  it('switches a take between cleaned and as heard, from the recording each time', async () => {
    const { project, segment, dir } = clip()
    const cleaned = await saveRecordedNarration(project.id, segment.id, await roomyTake(0.04), baseDir)

    const asHeard = await setRecordingCleanUp(project.id, segment.id, false, baseDir)
    const again = await setRecordingCleanUp(project.id, segment.id, true, baseDir)

    expect(asHeard.recording).toEqual({ original: cleaned.recording!.original, cleaned: false })
    expect(again.recording?.cleaned).toBe(true)
    // A new file each time, so undo can still reach the one before.
    expect(new Set([cleaned.audioFile, asHeard.audioFile, again.audioFile]).size).toBe(3)
    const cleanedTwice = await voiceOverRoom(join(dir, 'audio', again.audioFile as string))
    const cleanedOnce = await voiceOverRoom(join(dir, 'audio', cleaned.audioFile as string))
    expect(Math.abs(cleanedTwice - cleanedOnce)).toBeLessThan(1)
  }, 180_000)

  it('refuses a take that was not recorded, or was recorded before the recording was kept', async () => {
    const { project, segment } = clip()
    updateTranscriptSegmentAudio(project.id, segment.id, 'spoken.wav', 'Samantha', baseDir)
    await expect(setRecordingCleanUp(project.id, segment.id, true, baseDir)).rejects.toThrow('recorded in your own voice')

    updateTranscriptSegmentAudio(project.id, segment.id, 'old-take.wav', RECORDED_VOICE, baseDir)
    await expect(setRecordingCleanUp(project.id, segment.id, true, baseDir)).rejects.toThrow('recorded in your own voice')
  })
})
