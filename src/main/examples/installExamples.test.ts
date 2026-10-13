import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { installExamples, PROJECT_DIR_TOKEN, reinstallExamples } from './installExamples'
import { deleteProject, listProjects, openProject, readTimeline } from '../project/projectApi'
import { findProjectDir } from '../project/paths'

let home: string
let shipped: string

/** A shipped example as `npm run examples:rebuild` leaves it: a manifest and a project folder. */
function shipExample(id: string, name: string, order: number, version = 1): void {
  const project = join(shipped, id, 'project')
  mkdirSync(join(project, 'sources'), { recursive: true })
  writeFileSync(join(shipped, id, 'example.json'), JSON.stringify({ id, name, version, order }))
  writeFileSync(
    join(project, 'project.json'),
    JSON.stringify({ id: 'built-id', name, createdAt: '2026-01-01T00:00:00.000Z', schemaVersion: 1 })
  )
  writeFileSync(join(project, 'sources', 'picture.png'), 'png')
  writeFileSync(
    join(project, 'timeline.json'),
    JSON.stringify([
      { id: 'clip-1', kind: 'image', start: 0, duration: 90, data: { src: `${PROJECT_DIR_TOKEN}/sources/picture.png` } }
    ])
  )
  writeFileSync(join(project, 'transcript.json'), '[]')
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'talkie-examples-'))
  shipped = join(home, 'shipped')
  shipExample('meet-talkie', 'Meet Talkie', 0)
  shipExample('product-launch', 'Product launch', 1)
})

afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('the examples Talkie ships with', () => {
  it('arrive among the projects on first launch, in the order they are meant to be opened', () => {
    installExamples(home, shipped)

    expect(listProjects(home).map((project) => project.name)).toEqual(['Meet Talkie', 'Product launch'])
    expect(listProjects(home).map((project) => project.example)).toEqual(['meet-talkie', 'product-launch'])
  })

  it('point their clips at their own copy of the media, wherever they land', () => {
    const [id] = installExamples(home, shipped)

    const src = (readTimeline(id, home)[0].data as { src: string }).src
    expect(src).toBe(join(findProjectDir(id, home)!, 'sources', 'picture.png'))
    expect(existsSync(src)).toBe(true)
  })

  it('are installed once, not on every launch', () => {
    installExamples(home, shipped)
    expect(installExamples(home, shipped)).toEqual([])

    expect(listProjects(home)).toHaveLength(2)
  })

  it('stay deleted when someone deletes one', () => {
    const [meet] = installExamples(home, shipped)
    deleteProject(meet, home)

    installExamples(home, shipped)

    expect(listProjects(home).map((project) => project.name)).toEqual(['Product launch'])
  })

  it('arrive once more when a later version ships a new one', () => {
    installExamples(home, shipped)
    shipExample('architecture', 'Architecture explainer', 2)

    expect(installExamples(home, shipped)).toHaveLength(1)
    expect(listProjects(home)).toHaveLength(3)
  })

  it('arrive again, beside the old copy, when one is rebuilt as a new version', () => {
    const [meet] = installExamples(home, shipped)
    shipExample('meet-talkie', 'Meet Talkie', 0, 2)

    const made = installExamples(home, shipped)

    expect(made).toHaveLength(1)
    expect(made).not.toContain(meet)
    expect(openProject(made[0], home).example).toBe('meet-talkie')
    expect(listProjects(home)).toHaveLength(3)
    expect(installExamples(home, shipped)).toEqual([])
  })

  it('can be reinstalled fresh, beside any copy that has been changed', () => {
    const [meet] = installExamples(home, shipped)

    const again = reinstallExamples(home, shipped)

    expect(again).toHaveLength(2)
    expect(again).not.toContain(meet)
    expect(listProjects(home)).toHaveLength(4)
    expect(openProject(again[0], home).example).toBe('meet-talkie')
  })

  it('do nothing when there are none to ship', () => {
    expect(installExamples(home, join(home, 'nowhere'))).toEqual([])
    expect(installExamples(home, null)).toEqual([])
  })
})
