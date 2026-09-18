import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  addTimelineItem,
  createProject,
  fitClipToNarration,
  readTimeline,
  splitTimelineItem
} from './projectApi'

const RECORDING = '/tmp/session/video.mp4'

function twoScenes(baseDir: string): string {
  const project = createProject('Scenes', baseDir)
  addTimelineItem(
    project.id,
    { kind: 'video', start: 0, duration: 300, data: { src: RECORDING, trimAfter: 300 } },
    baseDir
  )
  addTimelineItem(
    project.id,
    { kind: 'video', start: 300, duration: 600, data: { src: RECORDING, trimBefore: 300, trimAfter: 900 } },
    baseDir
  )
  return project.id
}

describe('making a clip long enough to hold its narration', () => {
  it('moves the cut later, so the scene plays more of the recording rather than holding a still', () => {
    // Scenes are stretches of one continuous file, so the boundary between two of them is the
    // one thing that can move without a frame being frozen, repeated or lost.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-scene-cut-'))
    const projectId = twoScenes(baseDir)

    fitClipToNarration(projectId, readTimeline(projectId, baseDir)[0].id, 360, baseDir)
    const [first, second] = readTimeline(projectId, baseDir)

    expect(first.duration).toBe(360)
    expect((first.data as { trimAfter: number }).trimAfter).toBe(360)
    // What the first gained, the second starts that much further in — the recording still runs
    // through the cut unbroken.
    expect((second.data as { trimBefore: number }).trimBefore).toBe(360)
    expect(second.start).toBe(360)
    expect(second.duration).toBe(540)

    rmSync(baseDir, { recursive: true, force: true })
  })

  it('never borrows so much that the next scene is left too short to be worth having', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-scene-cut-floor-'))
    const projectId = twoScenes(baseDir)

    fitClipToNarration(projectId, readTimeline(projectId, baseDir)[0].id, 5000, baseDir)
    const [, second] = readTimeline(projectId, baseDir)

    expect(second.duration).toBe(150)

    rmSync(baseDir, { recursive: true, force: true })
  })

  it('leaves the last scene of a recording to run past its own footage, as a single clip always did', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-scene-cut-last-'))
    const projectId = twoScenes(baseDir)
    const last = readTimeline(projectId, baseDir)[1]

    const grown = fitClipToNarration(projectId, last.id, 900, baseDir)

    expect(grown.duration).toBe(900)
    expect((grown.data as { trimAfter: number }).trimAfter).toBe(900)

    rmSync(baseDir, { recursive: true, force: true })
  })

  it('never shortens a recording to fit narration that came out shorter', () => {
    // The footage is the demo. Trimming it to the length of the words would silently cut the
    // end off whatever was being shown.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-scene-cut-shrink-'))
    const projectId = twoScenes(baseDir)

    const kept = fitClipToNarration(projectId, readTimeline(projectId, baseDir)[0].id, 30, baseDir)

    expect(kept.duration).toBe(300)

    rmSync(baseDir, { recursive: true, force: true })
  })

  it('lets a slide be exactly as long as the words, having no picture of its own to protect', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-scene-cut-slide-'))
    const project = createProject('Slides', baseDir)
    const slide = addTimelineItem(
      project.id,
      { kind: 'scene', start: 0, duration: 300, data: { title: 'Hello' } },
      baseDir
    )

    expect(fitClipToNarration(project.id, slide.id, 120, baseDir).duration).toBe(120)

    rmSync(baseDir, { recursive: true, force: true })
  })
})

describe('splitting a scene by hand', () => {
  it('stops the first half where the second one starts', () => {
    // Both halves play the same file. A first half still carrying the whole scene's end claims
    // footage it no longer owns: narration gets fitted against room that is not there, and
    // lengthening it replays the frames the second half is about to show.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-scene-split-'))
    const project = createProject('Split', baseDir)
    const scene = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 600, data: { src: RECORDING, trimBefore: 300, trimAfter: 900 } },
      baseDir
    )

    const [first, second] = splitTimelineItem(project.id, scene.id, 200, baseDir)

    expect(first.data).toMatchObject({ trimBefore: 300, trimAfter: 500 })
    expect(second.data).toMatchObject({ trimBefore: 500, trimAfter: 900 })
    expect(first.duration).toBe(200)
    expect(second.duration).toBe(400)

    rmSync(baseDir, { recursive: true, force: true })
  })

  it('gives a half split off a whole-file clip an end of its own', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-scene-split-whole-'))
    const project = createProject('Split Whole', baseDir)
    const clip = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 600, data: { src: RECORDING } },
      baseDir
    )

    const [first, second] = splitTimelineItem(project.id, clip.id, 250, baseDir)

    expect(first.data).toMatchObject({ trimAfter: 250 })
    expect(second.data).toMatchObject({ trimBefore: 250 })

    rmSync(baseDir, { recursive: true, force: true })
  })
})
