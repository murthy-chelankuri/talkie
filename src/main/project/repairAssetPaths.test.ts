import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { projectsRootDir } from './paths'
import { repairAssetPaths } from './repairAssetPaths'
import { readTimelineFile } from './timelineFile'

describe('repairAssetPaths', () => {
  let baseDir: string
  let projectDir: string
  const DIR_NAME = 'abc123-checkout'

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-repair-test-'))
    projectDir = join(projectsRootDir(baseDir), DIR_NAME)
    mkdirSync(join(projectDir, 'sources', 'images'), { recursive: true })
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  function writeTimeline(items: unknown): void {
    writeFileSync(join(projectDir, 'timeline.json'), JSON.stringify(items))
  }

  function readTimeline(): Array<{ data: { src: string } }> {
    return JSON.parse(readFileSync(join(projectDir, 'timeline.json'), 'utf-8'))
  }

  function item(src: string): unknown {
    return { id: 'i1', kind: 'image', start: 0, duration: 90, data: { src } }
  }

  it('re-roots a path left behind by a moved projects folder', () => {
    const media = join(projectDir, 'sources', 'images', 'shot.png')
    writeFileSync(media, 'png-bytes')
    writeTimeline([item(`/somewhere/old/DemoStudio/Projects/${DIR_NAME}/sources/images/shot.png`)])

    repairAssetPaths(baseDir)

    expect(readTimeline()[0].data.src).toBe('sources/images/shot.png')
    expect((readTimelineFile(projectDir)[0] as { data: { src: string } }).data.src).toBe(media)
  })

  it('repairs every item that needs it', () => {
    mkdirSync(join(projectDir, 'sources', 'session-1'), { recursive: true })
    writeFileSync(join(projectDir, 'sources', 'images', 'a.png'), 'a')
    writeFileSync(join(projectDir, 'sources', 'session-1', 'video.mp4'), 'v')
    writeTimeline([
      item(`/old/Projects/${DIR_NAME}/sources/images/a.png`),
      item(`/old/Projects/${DIR_NAME}/sources/session-1/video.mp4`)
    ])

    repairAssetPaths(baseDir)

    const repaired = readTimeline()
    expect(repaired[0].data.src).toBe('sources/images/a.png')
    expect(repaired[1].data.src).toBe('sources/session-1/video.mp4')
  })

  it('stores media inside the project relative to it, so the timeline names no Mac', () => {
    const media = join(projectDir, 'sources', 'images', 'shot.png')
    writeFileSync(media, 'png-bytes')
    writeTimeline([item(media)])

    repairAssetPaths(baseDir)

    expect(readFileSync(join(projectDir, 'timeline.json'), 'utf-8')).not.toContain(baseDir)
    expect(readTimeline()[0].data.src).toBe('sources/images/shot.png')
  })

  it('does not touch a timeline that is already portable', () => {
    writeFileSync(join(projectDir, 'sources', 'images', 'shot.png'), 'png-bytes')
    writeTimeline([item('sources/images/shot.png')])
    repairAssetPaths(baseDir)
    const before = statSync(join(projectDir, 'timeline.json')).mtimeMs

    repairAssetPaths(baseDir)

    expect(statSync(join(projectDir, 'timeline.json')).mtimeMs).toBe(before)
  })

  it('keeps the full path of media outside the project', () => {
    writeTimeline([item('/Library/Desktop Pictures/elsewhere.png')])

    repairAssetPaths(baseDir)

    expect(readTimeline()[0].data.src).toBe('/Library/Desktop Pictures/elsewhere.png')
  })

  it('leaves a path alone when the media is not at the new location either', () => {
    const missing = `/old/Projects/${DIR_NAME}/sources/images/gone.png`
    writeTimeline([item(missing)])

    repairAssetPaths(baseDir)

    // Guessing would lose the only record of where the file came from.
    expect(readTimeline()[0].data.src).toBe(missing)
  })

  it('is safe to run twice', () => {
    const media = join(projectDir, 'sources', 'images', 'shot.png')
    writeFileSync(media, 'png-bytes')
    writeTimeline([item(`/old/Projects/${DIR_NAME}/sources/images/shot.png`)])

    repairAssetPaths(baseDir)
    repairAssetPaths(baseDir)

    expect(readTimeline()[0].data.src).toBe('sources/images/shot.png')
    expect(media).toBe(join(projectDir, 'sources', 'images', 'shot.png'))
  })

  it('survives a project with no timeline yet', () => {
    expect(() => repairAssetPaths(baseDir)).not.toThrow()
  })

  it('survives an unreadable timeline without taking the app down', () => {
    writeFileSync(join(projectDir, 'timeline.json'), 'not json at all')

    expect(() => repairAssetPaths(baseDir)).not.toThrow()
    expect(readFileSync(join(projectDir, 'timeline.json'), 'utf-8')).toBe('not json at all')
  })

  it('does nothing when there is no projects folder', () => {
    const empty = mkdtempSync(join(tmpdir(), 'talkie-repair-empty-'))
    expect(() => repairAssetPaths(empty)).not.toThrow()
    rmSync(empty, { recursive: true, force: true })
  })
})
