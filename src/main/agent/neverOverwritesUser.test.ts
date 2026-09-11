import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createProject,
  addTimelineItem,
  addTranscriptSegment,
  readTranscript,
  updateTranscriptSegmentText,
  setDraftedNarration
} from '../project/projectApi'
import { saveSlides } from '../slides/importSlides'
import { draftNarrationForItem, draftNarrationForProject } from './draftNarration'

/**
 * The rule the whole agent turns on: it may fill a silence, never take words away.
 *
 * Auto-drafting runs without being asked — on import, and across a whole project from one
 * button — so a mistake here quietly destroys writing someone did by hand. Status is what
 * separates the two: anything the user typed or voiced is `edited` or `narrated`, and only the
 * agent's own `draft` may be replaced without being asked.
 */
describe('drafting never takes the user\'s words away', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-nooverwrite-'))
    process.env.HOME = baseDir
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  function clip(project: { id: string }, index = 0) {
    return addTimelineItem(
      project.id,
      { kind: 'image', start: index * 90, duration: 90, data: { src: `/${index}.png` } },
      baseDir
    )
  }

  it('leaves narration the user typed exactly as it was', async () => {
    const project = createProject('Typed', baseDir)
    const item = clip(project)
    addTranscriptSegment(project.id, { text: 'Words I chose myself', timelineItemId: item.id }, baseDir)

    await draftNarrationForItem(project.id, item.id, {}, baseDir)

    expect(readTranscript(project.id, baseDir)[0].text).toBe('Words I chose myself')
  })

  it('leaves narration the user edited after the agent drafted it', async () => {
    const project = createProject('Edited', baseDir)
    const item = clip(project)
    await draftNarrationForItem(project.id, item.id, {}, baseDir)
    const segment = readTranscript(project.id, baseDir)[0]
    updateTranscriptSegmentText(project.id, segment.id, 'I rewrote this', baseDir)

    await draftNarrationForItem(project.id, item.id, {}, baseDir)

    expect(readTranscript(project.id, baseDir)[0].text).toBe('I rewrote this')
  })

  it('leaves speaker notes that came in with a deck', async () => {
    const project = createProject('Deck', baseDir)
    const added = saveSlides(
      project.id,
      [{ png: new Uint8Array([1]) }, { png: new Uint8Array([2]) }],
      ['Notes I wrote in PowerPoint', 'And more of them'],
      baseDir
    )

    await draftNarrationForProject(project.id, {}, baseDir)

    const transcript = readTranscript(project.id, baseDir)
    expect(transcript.find((s) => s.timelineItemId === added[0].id)?.text).toBe('Notes I wrote in PowerPoint')
    expect(transcript.find((s) => s.timelineItemId === added[1].id)?.text).toBe('And more of them')
  })

  it('fills a clip that has nothing on it', async () => {
    const project = createProject('Empty', baseDir)
    const item = clip(project)

    await draftNarrationForItem(project.id, item.id, {}, baseDir)

    expect(readTranscript(project.id, baseDir)[0].text.trim().length).toBeGreaterThan(0)
  })

  it('replaces only its own earlier draft', async () => {
    const project = createProject('Redraft', baseDir)
    const item = clip(project)
    setDraftedNarration(project.id, item.id, 'An earlier guess', baseDir)

    await draftNarrationForItem(project.id, item.id, {}, baseDir)

    expect(readTranscript(project.id, baseDir)[0].text).not.toBe('An earlier guess')
  })

  it('replaces the user\'s words only when explicitly asked to', async () => {
    const project = createProject('Forced', baseDir)
    const item = clip(project)
    addTranscriptSegment(project.id, { text: 'Words I chose myself', timelineItemId: item.id }, baseDir)

    await draftNarrationForItem(project.id, item.id, { force: true }, baseDir)

    expect(readTranscript(project.id, baseDir)[0].text).not.toBe('Words I chose myself')
  })

  it('across a whole project, touches only the clips that were silent', async () => {
    const project = createProject('Mixed', baseDir)
    const first = clip(project, 0)
    const second = clip(project, 1)
    const third = clip(project, 2)
    addTranscriptSegment(project.id, { text: 'Mine', timelineItemId: second.id }, baseDir)

    const results = await draftNarrationForProject(project.id, {}, baseDir)

    expect(results.map((r) => r.status)).toEqual(['drafted', 'skipped', 'drafted'])
    const transcript = readTranscript(project.id, baseDir)
    expect(transcript.find((s) => s.timelineItemId === second.id)?.text).toBe('Mine')
    expect(transcript.find((s) => s.timelineItemId === first.id)?.status).toBe('draft')
    expect(transcript.find((s) => s.timelineItemId === third.id)?.status).toBe('draft')
  })

  it('never leaves a clip with more than one narration to choose between', async () => {
    const project = createProject('Single', baseDir)
    const item = clip(project)

    await draftNarrationForItem(project.id, item.id, {}, baseDir)
    await draftNarrationForItem(project.id, item.id, { force: true }, baseDir)
    await draftNarrationForItem(project.id, item.id, { force: true }, baseDir)

    // Playback resolves one narration per clip, so a second would simply never be heard.
    expect(readTranscript(project.id, baseDir).filter((s) => s.timelineItemId === item.id)).toHaveLength(1)
  })
})
