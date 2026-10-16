import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { playable, toEditFrame, toPlayFrame, uniqueVersionName, NO_VERSIONS } from './versions'
import { chooseVersion, createVersion, deleteVersion, leftOutNow, readVersions, renameVersion, setClipIncluded } from './versionsStore'
import { createProject } from './projectApi'
import { findProjectDir } from './paths'
import { undo, withHistory } from './history'

// Intro 0–100, Deep dive 100–250, Demo 250–400, Pricing 400–450, Close 450–500.
const TIMELINE = [
  { id: 'intro', start: 0, duration: 100 },
  { id: 'deep', start: 100, duration: 150 },
  { id: 'demo', start: 250, duration: 150 },
  { id: 'pricing', start: 400, duration: 50 },
  { id: 'close', start: 450, duration: 50 }
]

describe('a version of the video', () => {
  it('plays everything, unchanged, when nothing is left out', () => {
    expect(playable(TIMELINE, [])).toBe(TIMELINE)
  })

  it('closes up the gap where a scene is left out, so the video runs on', () => {
    expect(playable(TIMELINE, ['deep', 'pricing']).map((clip) => [clip.id, clip.start])).toEqual([
      ['intro', 0],
      ['demo', 100],
      ['close', 250]
    ])
  })

  it('maps the timeline to the video and back, across scenes left out at the start, middle and end', () => {
    for (const leftOut of [['intro'], ['deep', 'pricing'], ['close'], ['intro', 'demo', 'close']]) {
      const kept = TIMELINE.filter((clip) => !leftOut.includes(clip.id))
      for (const clip of kept) {
        for (const offset of [0, 1, clip.duration - 1]) {
          const edit = clip.start + offset
          const play = toPlayFrame(TIMELINE, leftOut, edit)
          expect(toEditFrame(TIMELINE, leftOut, play), `${leftOut.join('+')} at ${edit}`).toBe(edit)
        }
      }
    }
  })

  it('takes a point inside a left-out scene to where the next scene played starts', () => {
    // Deep dive is out, so frame 180 of the timeline is where Demo begins in the video: frame 100.
    expect(toPlayFrame(TIMELINE, ['deep'], 180)).toBe(100)
    expect(toEditFrame(TIMELINE, ['deep'], 100)).toBe(250)
  })

  it('keeps names apart, so two versions are never both called "Short"', () => {
    const versions = { active: 'a', versions: [{ id: 'a', name: 'Short', leftOut: [] }] }
    expect(uniqueVersionName('short', versions)).toBe('short 2')
    expect(uniqueVersionName('Short', versions, 'a')).toBe('Short')
    expect(uniqueVersionName('  ', NO_VERSIONS)).toBe('Version')
  })
})

describe('the versions of a project', () => {
  let baseDir: string
  let id: string
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-versions-'))
    id = createProject('Cuts', baseDir).id
  })
  afterEach(() => rmSync(baseDir, { recursive: true, force: true }))

  it('is the full video, written nowhere, until a scene is left out', () => {
    expect(readVersions(id, baseDir).versions.map((version) => version.name)).toEqual(['Full video'])
    expect(existsSync(join(findProjectDir(id, baseDir)!, 'versions.json'))).toBe(false)
  })

  it('leaves scenes out of the version being worked on, and puts them back', () => {
    setClipIncluded(id, 'deep', false, baseDir)
    setClipIncluded(id, 'pricing', false, baseDir)
    setClipIncluded(id, 'deep', true, baseDir)
    expect(leftOutNow(id, baseDir)).toEqual(['pricing'])
  })

  it('starts a new version from the one being worked on, and keeps each version’s cut its own', () => {
    setClipIncluded(id, 'deep', false, baseDir)
    const short = createVersion(id, '2-minute', baseDir)
    expect(leftOutNow(id, baseDir)).toEqual(['deep'])
    setClipIncluded(id, 'pricing', false, baseDir)

    chooseVersion(id, 'full', baseDir)
    expect(leftOutNow(id, baseDir)).toEqual(['deep'])
    chooseVersion(id, short.active, baseDir)
    expect(leftOutNow(id, baseDir)).toEqual(['deep', 'pricing'])
  })

  it('renames and deletes versions, but never the last one', () => {
    const made = createVersion(id, 'For sales', baseDir)
    renameVersion(id, made.active, 'Sales', baseDir)
    expect(readVersions(id, baseDir).versions.map((version) => version.name)).toEqual(['Full video', 'Sales'])

    // Deleting the one being worked on moves the work to another.
    expect(deleteVersion(id, made.active, baseDir).active).toBe('full')
    expect(() => deleteVersion(id, 'full', baseDir)).toThrow(/at least one version/)
  })

  it('undoes leaving a scene out like any other edit', () => {
    withHistory(id, () => setClipIncluded(id, 'deep', false, baseDir), baseDir)
    expect(leftOutNow(id, baseDir)).toEqual(['deep'])

    undo(id, baseDir)
    expect(leftOutNow(id, baseDir)).toEqual([])
    expect(existsSync(join(findProjectDir(id, baseDir)!, 'versions.json'))).toBe(false)
  })
})
