import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject, listProjects, openProject, readTimeline, addTimelineItem, importImage } from './projectApi'
import { projectsRootDir, findProjectDir, PROJECT_SUBDIRS } from './paths'

describe('createProject', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('returns metadata with a generated id and the given name', () => {
    const metadata = createProject('Checkout Flow', baseDir)

    expect(metadata.name).toBe('Checkout Flow')
    expect(metadata.id).toBeTruthy()
    expect(metadata.schemaVersion).toBe(1)
  })

  it('creates the project directory with the expected subdirectories', () => {
    const metadata = createProject('Checkout Flow', baseDir)
    const dir = findProjectDir(metadata.id, baseDir)

    expect(dir).toBeDefined()
    for (const subdir of PROJECT_SUBDIRS) {
      expect(existsSync(join(dir as string, subdir))).toBe(true)
    }
  })

  it('writes project.json, timeline.json, and transcript.json', () => {
    const metadata = createProject('Checkout Flow', baseDir)
    const dir = findProjectDir(metadata.id, baseDir) as string

    expect(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf-8'))).toEqual(metadata)
    expect(JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf-8'))).toEqual([])
    expect(JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf-8'))).toEqual([])
  })

  it('slugifies the name into the folder name', () => {
    const metadata = createProject('Checkout Flow!', baseDir)
    const dir = findProjectDir(metadata.id, baseDir) as string

    expect(dir.endsWith(`${metadata.id}-checkout-flow`)).toBe(true)
  })

  it('throws instead of writing an unopenable project when the name is empty', () => {
    expect(() => createProject('', baseDir)).toThrow()

    // No project.json should have been written anywhere under the root.
    const root = projectsRootDir(baseDir)
    if (existsSync(root)) {
      expect(listProjects(baseDir)).toEqual([])
    }
  })
})

describe('listProjects', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('returns an empty list when no projects exist', () => {
    expect(listProjects(baseDir)).toEqual([])
  })

  it('lists created projects newest first', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const first = createProject('First Project', baseDir)

    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
    const second = createProject('Second Project', baseDir)
    vi.useRealTimers()

    const summaries = listProjects(baseDir)

    expect(summaries.map((p) => p.id)).toEqual([second.id, first.id])
  })

  it('omits schemaVersion from the summary', () => {
    createProject('Checkout Flow', baseDir)

    expect(listProjects(baseDir)[0]).toEqual({
      id: expect.any(String),
      name: 'Checkout Flow',
      createdAt: expect.any(String)
    })
  })

  it('skips a project with unparseable project.json but still returns healthy ones', () => {
    const healthy = createProject('Healthy Project', baseDir)

    const root = projectsRootDir(baseDir)
    const brokenDir = join(root, 'broken-id-broken-project')
    mkdirSync(brokenDir, { recursive: true })
    writeFileSync(join(brokenDir, 'project.json'), '{ this is not valid json', 'utf-8')

    const summaries = listProjects(baseDir)

    expect(summaries).toEqual([
      { id: healthy.id, name: healthy.name, createdAt: healthy.createdAt }
    ])
  })

  it('skips a project with a schemaVersion newer than supported but still returns healthy ones', () => {
    const healthy = createProject('Healthy Project', baseDir)

    const root = projectsRootDir(baseDir)
    const futureDir = join(root, 'future-id-future-project')
    mkdirSync(futureDir, { recursive: true })
    writeFileSync(
      join(futureDir, 'project.json'),
      JSON.stringify({
        id: 'future-id',
        name: 'Future Project',
        createdAt: new Date().toISOString(),
        schemaVersion: 999
      }),
      'utf-8'
    )

    const summaries = listProjects(baseDir)

    expect(summaries).toEqual([
      { id: healthy.id, name: healthy.name, createdAt: healthy.createdAt }
    ])
  })
})

describe('openProject', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('returns the full metadata for an existing project', () => {
    const created = createProject('Checkout Flow', baseDir)

    expect(openProject(created.id, baseDir)).toEqual(created)
  })

  it('throws a clear error when the project does not exist', () => {
    expect(() => openProject('does-not-exist', baseDir)).toThrow(
      'No project found with id does-not-exist'
    )
  })

  it('throws the same clear error when the matched directory has no project.json', () => {
    const root = projectsRootDir(baseDir)
    const id = 'partial-id'
    mkdirSync(join(root, `${id}-partial-project`), { recursive: true })

    expect(() => openProject(id, baseDir)).toThrow(`No project found with id ${id}`)
  })
})

describe('readTimeline', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('returns an empty array for a freshly created project', () => {
    const project = createProject('Empty Timeline', baseDir)

    expect(readTimeline(project.id, baseDir)).toEqual([])
  })

  it('throws when the project does not exist', () => {
    expect(() => readTimeline('does-not-exist', baseDir)).toThrow('No project found with id does-not-exist')
  })
})

describe('addTimelineItem', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('appends a validated item and returns it with a generated id', () => {
    const project = createProject('Add Item', baseDir)

    const added = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)

    expect(added.id).toBeTruthy()
    expect(added.kind).toBe('image')
    expect(readTimeline(project.id, baseDir)).toEqual([added])
  })

  it('appends a second item after the first without overwriting it', () => {
    const project = createProject('Add Two Items', baseDir)

    const first = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)
    const second = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/tmp/b.png' } }, baseDir)

    expect(readTimeline(project.id, baseDir)).toEqual([first, second])
  })

  it('rejects invalid item data and writes nothing', () => {
    const project = createProject('Reject Invalid', baseDir)

    expect(() => addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: {} }, baseDir)).toThrow(
      /Invalid data for kind "image"/
    )
    expect(readTimeline(project.id, baseDir)).toEqual([])
  })
})

describe('importImage', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('copies the source file into sources/images and adds a timeline item', () => {
    const project = createProject('Import Image', baseDir)
    const sourcePath = join(baseDir, 'original.png')
    writeFileSync(sourcePath, 'fake-png-bytes')

    const item = importImage(project.id, sourcePath, baseDir)

    expect(item.kind).toBe('image')
    const data = item.data as { src: string }
    expect(existsSync(data.src)).toBe(true)
    expect(readFileSync(data.src, 'utf-8')).toBe('fake-png-bytes')
    expect(readTimeline(project.id, baseDir)).toEqual([item])
  })

  it('places the copy inside the project sources/images directory, not the source location', () => {
    const project = createProject('Import Image Location', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    const sourcePath = join(baseDir, 'original.png')
    writeFileSync(sourcePath, 'fake-png-bytes')

    const item = importImage(project.id, sourcePath, baseDir)

    const data = item.data as { src: string }
    expect(data.src.startsWith(join(dir, 'sources', 'images'))).toBe(true)
  })

  it('appends after the current end of the timeline rather than always starting at 0', () => {
    const project = createProject('Import Sequential', baseDir)
    const sourcePath = join(baseDir, 'original.png')
    writeFileSync(sourcePath, 'fake-png-bytes')

    const first = importImage(project.id, sourcePath, baseDir)
    const second = importImage(project.id, sourcePath, baseDir)

    expect(second.start).toBe(first.start + first.duration)
  })
})
