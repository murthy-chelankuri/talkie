import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createProject,
  addScene,
  addTimelineItem,
  updateSceneData,
  writeDiagramSvg,
  readTimeline,
  DEFAULT_SCENE_DURATION_FRAMES
} from './projectApi'

describe('scenes written in the app', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-scenes-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('adds a slide with a heading and lines under it', () => {
    const project = createProject('Scenes', baseDir)

    const item = addScene(project.id, 'scene', { title: 'How it works', bullets: ['Record', 'Narrate'] }, baseDir)

    expect(item.kind).toBe('scene')
    expect(item.duration).toBe(DEFAULT_SCENE_DURATION_FRAMES)
    expect(readTimeline(project.id, baseDir)[0].data).toEqual({
      title: 'How it works',
      bullets: ['Record', 'Narrate']
    })
  })

  it('adds a slide with no lines at all', () => {
    const project = createProject('Scenes', baseDir)

    const item = addScene(project.id, 'scene', { title: 'Just a title' }, baseDir)

    expect((readTimeline(project.id, baseDir).find((i) => i.id === item.id)?.data as { bullets: string[] }).bullets)
      .toEqual([])
  })

  it('adds a diagram from its source', () => {
    const project = createProject('Scenes', baseDir)

    const item = addScene(project.id, 'diagram', { source: 'graph TD; A-->B;' }, baseDir)

    expect(item.kind).toBe('diagram')
    expect(readTimeline(project.id, baseDir)[0].data).toEqual({ source: 'graph TD; A-->B;' })
  })

  it('appends a scene after whatever is already there', () => {
    const project = createProject('Scenes', baseDir)
    addTimelineItem(project.id, { kind: 'image', start: 0, duration: 120, data: { src: '/a.png' } }, baseDir)

    const item = addScene(project.id, 'scene', { title: 'Second' }, baseDir)

    expect(item.start).toBe(120)
  })

  it('rejects a slide with no title, since there would be nothing to show', () => {
    const project = createProject('Scenes', baseDir)

    expect(() => addScene(project.id, 'scene', { bullets: ['a'] }, baseDir)).toThrow()
  })

  it('edits a scene without moving it or changing its length', () => {
    const project = createProject('Scenes', baseDir)
    const item = addScene(project.id, 'scene', { title: 'Before', bullets: [] }, baseDir)

    const updated = updateSceneData(project.id, item.id, { title: 'After', bullets: ['One'] }, baseDir)

    expect(updated.start).toBe(item.start)
    expect(updated.duration).toBe(item.duration)
    expect(updated.data).toEqual({ title: 'After', bullets: ['One'] })
  })

  it('refuses to write content that does not fit the kind of scene it is', () => {
    const project = createProject('Scenes', baseDir)
    const item = addScene(project.id, 'scene', { title: 'Before' }, baseDir)

    expect(() => updateSceneData(project.id, item.id, { nonsense: true }, baseDir)).toThrow()
  })

  it('names a scene that is not there rather than guessing', () => {
    const project = createProject('Scenes', baseDir)

    expect(() => updateSceneData(project.id, 'nope', { title: 'x' }, baseDir)).toThrow(
      'No timeline item found with id nope'
    )
  })

  it('saves a drawn diagram inside the project', () => {
    const project = createProject('Scenes', baseDir)

    const path = writeDiagramSvg(project.id, '<svg><rect/></svg>', baseDir)

    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf-8')).toBe('<svg><rect/></svg>')
    expect(path.endsWith('.svg')).toBe(true)
  })

  it('keeps each drawing as its own file, so undo can reach the one before', () => {
    const project = createProject('Scenes', baseDir)

    const first = writeDiagramSvg(project.id, '<svg>1</svg>', baseDir)
    const second = writeDiagramSvg(project.id, '<svg>2</svg>', baseDir)

    expect(second).not.toBe(first)
    expect(readFileSync(first, 'utf-8')).toBe('<svg>1</svg>')
  })
})
