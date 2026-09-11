import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createProject,
  addTimelineItem,
  addTranscriptSegment,
  readTranscript,
  updateTranscriptSegmentText
} from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { updateSettings } from '../settings/settingsStore'
import { draftNarrationForItem, draftNarrationForProject } from './draftNarration'

describe('draftNarrationForItem', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-draft-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  function projectWithImage(name = 'Draft Test') {
    const project = createProject(name, baseDir)
    const item = addTimelineItem(
      project.id,
      { kind: 'image', start: 0, duration: 90, data: { src: '/no/such/image.png' } },
      baseDir
    )
    return { project, item }
  }

  it('writes narration for a clip that has none', async () => {
    const { project, item } = projectWithImage()

    const result = await draftNarrationForItem(project.id, item.id, {}, baseDir)

    expect(result.status).toBe('drafted')
    expect(readTranscript(project.id, baseDir)[0].text).toBe('Slide 1 of 1.')
  })

  it('marks what it wrote as a draft, not as the user\'s words', async () => {
    const { project, item } = projectWithImage()

    await draftNarrationForItem(project.id, item.id, {}, baseDir)

    expect(readTranscript(project.id, baseDir)[0].status).toBe('draft')
  })

  it('refuses to overwrite narration the user wrote', async () => {
    const { project, item } = projectWithImage()
    addTranscriptSegment(project.id, { text: 'My own careful words', timelineItemId: item.id }, baseDir)

    const result = await draftNarrationForItem(project.id, item.id, {}, baseDir)

    expect(result.status).toBe('skipped')
    expect(readTranscript(project.id, baseDir)[0].text).toBe('My own careful words')
  })

  it('replaces the user\'s words only when asked outright', async () => {
    const { project, item } = projectWithImage()
    addTranscriptSegment(project.id, { text: 'My own careful words', timelineItemId: item.id }, baseDir)

    const result = await draftNarrationForItem(project.id, item.id, { force: true }, baseDir)

    expect(result.status).toBe('drafted')
    expect(readTranscript(project.id, baseDir)[0].text).toBe('Slide 1 of 1.')
  })

  it('replaces its own earlier draft without being asked', async () => {
    const { project, item } = projectWithImage()
    await draftNarrationForItem(project.id, item.id, {}, baseDir)

    const result = await draftNarrationForItem(project.id, item.id, {}, baseDir)

    expect(result.status).toBe('drafted')
    expect(readTranscript(project.id, baseDir)).toHaveLength(1)
  })

  it('treats a segment the user edited as theirs from then on', async () => {
    const { project, item } = projectWithImage()
    await draftNarrationForItem(project.id, item.id, {}, baseDir)
    const segment = readTranscript(project.id, baseDir)[0]
    updateTranscriptSegmentText(project.id, segment.id, 'I rewrote this myself', baseDir)

    const result = await draftNarrationForItem(project.id, item.id, {}, baseDir)

    expect(result.status).toBe('skipped')
    expect(readTranscript(project.id, baseDir)[0].text).toBe('I rewrote this myself')
  })

  it('reports what is missing instead of throwing when the provider is unavailable', async () => {
    const { project, item } = projectWithImage()
    updateSettings({ narration: { provider: 'anthropic' } }, baseDir)

    const result = await draftNarrationForItem(project.id, item.id, {}, baseDir)

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('Anthropic API key')
    expect(readTranscript(project.id, baseDir)).toEqual([])
  })

  it('keeps a record of every run in the project', async () => {
    const { project, item } = projectWithImage()

    await draftNarrationForItem(project.id, item.id, {}, baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    const logPath = join(dir, 'agents', 'runs', 'narration.jsonl')
    expect(existsSync(logPath)).toBe(true)

    const entry = JSON.parse(readFileSync(logPath, 'utf-8').trim())
    expect(entry).toMatchObject({ provider: 'template', status: 'drafted', timelineItemId: item.id })
    expect(entry.words).toBe(4)
  })

  it('records a failure as well as a success', async () => {
    const { project, item } = projectWithImage()
    updateSettings({ narration: { provider: 'anthropic' } }, baseDir)

    await draftNarrationForItem(project.id, item.id, {}, baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    const entry = JSON.parse(readFileSync(join(dir, 'agents', 'runs', 'narration.jsonl'), 'utf-8').trim())
    expect(entry.status).toBe('failed')
  })

  it('names the clip it could not find rather than guessing', async () => {
    const project = createProject('Empty', baseDir)

    await expect(draftNarrationForItem(project.id, 'nope', {}, baseDir)).rejects.toThrow(
      'No timeline item found with id nope'
    )
  })
})

describe('draftNarrationForProject', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-draft-all-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('drafts every clip that needs it and leaves the rest alone', async () => {
    const project = createProject('All', baseDir)
    const first = addTimelineItem(
      project.id,
      { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } },
      baseDir
    )
    const second = addTimelineItem(
      project.id,
      { kind: 'image', start: 90, duration: 90, data: { src: '/b.png' } },
      baseDir
    )
    addTranscriptSegment(project.id, { text: 'Mine', timelineItemId: second.id }, baseDir)

    const results = await draftNarrationForProject(project.id, {}, baseDir)

    expect(results.map((r) => r.status)).toEqual(['drafted', 'skipped'])
    const transcript = readTranscript(project.id, baseDir)
    expect(transcript.find((s) => s.timelineItemId === first.id)?.text).toBe('Slide 1 of 2.')
    expect(transcript.find((s) => s.timelineItemId === second.id)?.text).toBe('Mine')
  })
})
