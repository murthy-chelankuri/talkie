import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { createProject, addTimelineItem } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { gatherClipEvidence } from './clipEvidence'
import { FPS } from '../../remotion/constants'

describe('gatherClipEvidence', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-evidence-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('gives an image its own file as the only frame to look at', async () => {
    const project = createProject('Image Evidence', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    const imagePath = join(dir, 'sources', 'images', 'slide.png')
    mkdirSync(dirname(imagePath), { recursive: true })
    writeFileSync(imagePath, 'png-bytes')

    const item = addTimelineItem(
      project.id,
      { kind: 'image', start: 0, duration: 90, data: { src: imagePath } },
      baseDir
    )

    const evidence = await gatherClipEvidence(project.id, item.id, baseDir)

    expect(evidence.kind).toBe('image')
    expect(evidence.framePaths).toEqual([imagePath])
    expect(evidence.actions).toEqual([])
    expect(evidence.durationSeconds).toBe(3)
  })

  it('reads the action log that sits beside the recording', async () => {
    const project = createProject('Video Evidence', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    const sessionDir = join(dir, 'sources', 'session-1')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'actions.jsonl'),
      [
        JSON.stringify({ t: 1000, type: 'navigation', url: 'https://example.com/' }),
        JSON.stringify({ t: 2000, type: 'click', selector: '#buy', text: 'Buy now' })
      ].join('\n')
    )

    const item = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 300, data: { src: join(sessionDir, 'video.mp4') } },
      baseDir
    )

    const evidence = await gatherClipEvidence(project.id, item.id, baseDir)

    expect(evidence.kind).toBe('video')
    expect(evidence.actions.map((a) => a.label)).toEqual(['example.com', 'clicked "Buy now"'])
  })

  it('windows the log to the part of the recording this clip actually shows', async () => {
    const project = createProject('Trimmed Evidence', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    const sessionDir = join(dir, 'sources', 'session-1')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'actions.jsonl'),
      [
        JSON.stringify({ t: 1000, type: 'click', selector: '#a', text: 'trimmed away' }),
        JSON.stringify({ t: 5000, type: 'click', selector: '#b', text: 'on screen' })
      ].join('\n')
    )

    // Trimmed to start 3s in, running 4s.
    const item = addTimelineItem(
      project.id,
      {
        kind: 'video',
        start: 0,
        duration: 4 * FPS,
        data: { src: join(sessionDir, 'video.mp4'), trimBefore: 3 * FPS }
      },
      baseDir
    )

    const evidence = await gatherClipEvidence(project.id, item.id, baseDir)

    expect(evidence.actions.map((a) => a.label)).toEqual(['clicked "on screen"'])
    // Timed from the clip's own start, so it matches the playhead.
    expect(evidence.actions[0].atSeconds).toBe(2)
  })

  it('still reports the actions when the video file is missing', async () => {
    const project = createProject('Missing Video', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    const sessionDir = join(dir, 'sources', 'session-1')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'actions.jsonl'), JSON.stringify({ t: 0, type: 'navigation', url: 'https://a.test/' }))

    const item = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 300, data: { src: join(sessionDir, 'gone.mp4') } },
      baseDir
    )

    const evidence = await gatherClipEvidence(project.id, item.id, baseDir)

    expect(evidence.framePaths).toEqual([])
    expect(evidence.actions).toHaveLength(1)
  })

  it('copes with a recording that never produced an action log', async () => {
    const project = createProject('No Log', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    const sessionDir = join(dir, 'sources', 'session-1')
    mkdirSync(sessionDir, { recursive: true })

    const item = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 300, data: { src: join(sessionDir, 'video.mp4') } },
      baseDir
    )

    const evidence = await gatherClipEvidence(project.id, item.id, baseDir)

    expect(evidence.actions).toEqual([])
  })

  it('refuses to guess at a clip that is not on the timeline', async () => {
    const project = createProject('Absent', baseDir)

    await expect(gatherClipEvidence(project.id, 'no-such-item', baseDir)).rejects.toThrow(
      'No timeline item found with id no-such-item'
    )
  })

  it('samples real frames out of a real recording', async () => {
    const source = process.env.HOME
      ? join(
          process.env.HOME,
          'Talkie/Projects/5330ff69-2824-4edd-aa4b-457b66e2d19a-sample/sources/session-1b5fd7f8-1a18-43c0-acd8-2b825d247613/video.mp4'
        )
      : ''
    if (!source || !existsSync(source)) return

    const project = createProject('Real Frames', baseDir)
    const item = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 20 * FPS, data: { src: source } },
      baseDir
    )

    const evidence = await gatherClipEvidence(project.id, item.id, baseDir)

    expect(evidence.framePaths.length).toBeGreaterThan(0)
    for (const path of evidence.framePaths) expect(existsSync(path)).toBe(true)

    evidence.cleanup?.()
    for (const path of evidence.framePaths) expect(existsSync(path)).toBe(false)
  }, 60_000)
})
