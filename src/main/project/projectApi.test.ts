import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createProject,
  listProjects,
  openProject,
  readTimeline,
  readTimelineLenient,
  addTimelineItem,
  importImage,
  readTranscript,
  addTranscriptSegment,
  updateTranscriptSegmentText,
  updateTranscriptSegmentAudio,
  updateTimelineItemDuration,
  reorderTimelineItems,
  readNarrationAudioPaths,
  splitTimelineItem,
  deleteTranscriptSegment,
  listProjectOverviews,
  deleteTimelineItem,
  sweepUnusedNarrationAudio,
  deleteProject,
  setProjectVoice
} from './projectApi'
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

describe('readTimeline missing timeline.json', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('throws "No project found" when timeline.json is missing', () => {
    const project = createProject('Missing Timeline', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    rmSync(join(dir, 'timeline.json'))

    expect(() => readTimeline(project.id, baseDir)).toThrow(`No project found with id ${project.id}`)
  })
})

describe('readTimelineLenient', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('skips an item with an unrecognized kind and returns the valid ones', () => {
    const project = createProject('Lenient Read', baseDir)
    addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    const timeline = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf-8'))
    timeline.push({ id: 'bad-item', kind: 'slide', start: 90, duration: 60, data: {} })
    writeFileSync(join(dir, 'timeline.json'), JSON.stringify(timeline))

    const result = readTimelineLenient(project.id, baseDir)

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('image')
  })

  it('throws "No project found" when timeline.json is missing, same as readTimeline', () => {
    const project = createProject('Lenient Missing', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    rmSync(join(dir, 'timeline.json'))

    expect(() => readTimelineLenient(project.id, baseDir)).toThrow(`No project found with id ${project.id}`)
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

describe('readTranscript', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('returns an empty array for a freshly created project', () => {
    const project = createProject('Empty Transcript', baseDir)

    expect(readTranscript(project.id, baseDir)).toEqual([])
  })

  it('throws when the project does not exist', () => {
    expect(() => readTranscript('does-not-exist', baseDir)).toThrow('No project found with id does-not-exist')
  })
})

describe('addTranscriptSegment', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('appends a segment with status "edited" and a generated id', () => {
    const project = createProject('Add Segment', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)

    const segment = addTranscriptSegment(project.id, { text: 'Hello', timelineItemId: item.id }, baseDir)

    expect(segment.id).toBeTruthy()
    expect(segment.text).toBe('Hello')
    expect(segment.timelineItemId).toBe(item.id)
    expect(segment.status).toBe('edited')
    expect(readTranscript(project.id, baseDir)).toEqual([segment])
  })
})

describe('updateTranscriptSegmentText', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('updates the text and resets status to "edited"', () => {
    const project = createProject('Update Text', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Original', timelineItemId: item.id }, baseDir)

    const updated = updateTranscriptSegmentText(project.id, segment.id, 'Changed', baseDir)

    expect(updated.text).toBe('Changed')
    expect(updated.status).toBe('edited')
    expect(readTranscript(project.id, baseDir)[0].text).toBe('Changed')
  })

  it('throws a clear error when the segment does not exist', () => {
    const project = createProject('Update Missing', baseDir)

    expect(() => updateTranscriptSegmentText(project.id, 'does-not-exist', 'x', baseDir)).toThrow(
      'No transcript segment found with id does-not-exist'
    )
  })
})

describe('updateTranscriptSegmentAudio', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('sets audioFile and status to "narrated"', () => {
    const project = createProject('Update Audio', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Hi', timelineItemId: item.id }, baseDir)

    const updated = updateTranscriptSegmentAudio(project.id, segment.id, `${segment.id}.wav`, 'Samantha', baseDir)

    expect(updated.audioFile).toBe(`${segment.id}.wav`)
    expect(updated.status).toBe('narrated')
  })
})

describe('updateTimelineItemDuration', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('updates only the duration of the matching item', () => {
    const project = createProject('Update Duration', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)

    const updated = updateTimelineItemDuration(project.id, item.id, 200, baseDir)

    expect(updated.duration).toBe(200)
    expect(updated.id).toBe(item.id)
    expect(updated.start).toBe(0)
  })

  it('throws a clear error when the timeline item does not exist', () => {
    const project = createProject('Update Duration Missing', baseDir)

    expect(() => updateTimelineItemDuration(project.id, 'does-not-exist', 100, baseDir)).toThrow(
      'No timeline item found with id does-not-exist'
    )
  })

  it('shifts later items so the timeline stays gap-free when an item grows', () => {
    const project = createProject('Update Duration Grow', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const b = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)

    updateTimelineItemDuration(project.id, a.id, 200, baseDir)

    const timeline = readTimeline(project.id, baseDir)
    expect(timeline.find((item) => item.id === a.id)?.start).toBe(0)
    expect(timeline.find((item) => item.id === b.id)?.start).toBe(200)
    expect(timeline.find((item) => item.id === b.id)?.duration).toBe(60)
  })

  it('shifts later items back when an item shrinks', () => {
    const project = createProject('Update Duration Shrink', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const b = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)

    updateTimelineItemDuration(project.id, a.id, 30, baseDir)

    const timeline = readTimeline(project.id, baseDir)
    expect(timeline.find((item) => item.id === b.id)?.start).toBe(30)
  })

  it('throws a flattened, non-JSON-escaped message when the duration is invalid', () => {
    const project = createProject('Update Duration Invalid', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/tmp/a.png' } }, baseDir)

    let thrown: unknown
    try {
      updateTimelineItemDuration(project.id, item.id, 0, baseDir)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    const message = (thrown as Error).message
    expect(message).not.toContain('\\"')
    expect(message).not.toContain('ZodError')
    expect(message.length).toBeGreaterThan(0)
    // The original timeline item must be left untouched.
    expect(readTimeline(project.id, baseDir)[0].duration).toBe(90)
  })
})

describe('reorderTimelineItems', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('reorders items and recomputes sequential start values from durations', () => {
    const project = createProject('Reorder', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const b = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)
    const c = addTimelineItem(project.id, { kind: 'image', start: 150, duration: 30, data: { src: '/c.png' } }, baseDir)

    const reordered = reorderTimelineItems(project.id, [c.id, a.id, b.id], baseDir)

    expect(reordered.map((item) => item.id)).toEqual([c.id, a.id, b.id])
    expect(reordered[0].start).toBe(0)
    expect(reordered[1].start).toBe(30)
    expect(reordered[2].start).toBe(120)
  })

  it('preserves each item\'s own duration', () => {
    const project = createProject('Reorder Durations', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const b = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)

    const reordered = reorderTimelineItems(project.id, [b.id, a.id], baseDir)

    expect(reordered.find((item) => item.id === a.id)?.duration).toBe(90)
    expect(reordered.find((item) => item.id === b.id)?.duration).toBe(60)
  })

  it('persists the new order to timeline.json', () => {
    const project = createProject('Reorder Persist', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const b = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)

    reorderTimelineItems(project.id, [b.id, a.id], baseDir)

    expect(readTimeline(project.id, baseDir).map((item) => item.id)).toEqual([b.id, a.id])
  })

  it('throws a clear error when orderedIds is missing an existing item', () => {
    const project = createProject('Reorder Missing', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)

    expect(() => reorderTimelineItems(project.id, [a.id], baseDir)).toThrow(
      `orderedIds must be a permutation of the existing timeline item ids for project ${project.id}`
    )
  })

  it('throws a clear error when orderedIds contains a duplicate', () => {
    const project = createProject('Reorder Duplicate', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const b = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)

    expect(() => reorderTimelineItems(project.id, [a.id, a.id], baseDir)).toThrow(
      `orderedIds must be a permutation of the existing timeline item ids for project ${project.id}`
    )
    void b
  })

  it('throws a clear error when orderedIds contains an unknown id', () => {
    const project = createProject('Reorder Unknown', baseDir)
    const a = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)

    expect(() => reorderTimelineItems(project.id, [a.id, 'does-not-exist'], baseDir)).toThrow(
      `orderedIds must be a permutation of the existing timeline item ids for project ${project.id}`
    )
  })
})

describe('readNarrationAudioPaths', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('returns an empty map when no segments are narrated', () => {
    const project = createProject('No Narration', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    addTranscriptSegment(project.id, { text: 'Hello', timelineItemId: item.id }, baseDir)

    expect(readNarrationAudioPaths(project.id, baseDir).size).toBe(0)
  })

  it('maps a narrated segment\'s timelineItemId to its absolute audio path', () => {
    const project = createProject('Narrated', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Hello', timelineItemId: item.id }, baseDir)
    updateTranscriptSegmentAudio(project.id, segment.id, `${segment.id}.wav`, 'Samantha', baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    const audioPath = join(dir, 'audio', `${segment.id}.wav`)
    writeFileSync(audioPath, 'pretend audio')

    const paths = readNarrationAudioPaths(project.id, baseDir)

    expect(paths.get(item.id)?.path).toBe(audioPath)
    // Re-narrating rewrites the same filename, so the URL has to change some other way or the
    // renderer keeps playing the audio it already cached.
    expect(paths.get(item.id)?.version).toBeGreaterThan(0)
  })

  it('leaves out narration whose audio file has gone missing', () => {
    const project = createProject('Narration Missing Audio', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Hello', timelineItemId: item.id }, baseDir)
    updateTranscriptSegmentAudio(project.id, segment.id, `${segment.id}.wav`, 'Samantha', baseDir)

    expect(readNarrationAudioPaths(project.id, baseDir).size).toBe(0)
  })

  it('throws when the project does not exist', () => {
    expect(() => readNarrationAudioPaths('does-not-exist', baseDir)).toThrow('No project found with id does-not-exist')
  })
})

describe('splitTimelineItem', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('splits an item into two clips that together keep the original length', () => {
    const project = createProject('Split', baseDir)
    const item = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 300, data: { src: '/v.webm' } },
      baseDir
    )

    const [first, second] = splitTimelineItem(project.id, item.id, 120, baseDir)

    expect(first.duration).toBe(120)
    expect(second.duration).toBe(180)
    expect(first.start).toBe(0)
    expect(second.start).toBe(120)
  })

  it('keeps the original id on the first half so transcript links survive', () => {
    const project = createProject('Split Ids', baseDir)
    const item = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 300, data: { src: '/v.webm' } },
      baseDir
    )

    const [first, second] = splitTimelineItem(project.id, item.id, 120, baseDir)

    expect(first.id).toBe(item.id)
    expect(second.id).not.toBe(item.id)
  })

  it('advances the second half past the footage the first half already shows', () => {
    const project = createProject('Split Trim', baseDir)
    const item = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 300, data: { src: '/v.webm', trimBefore: 45 } },
      baseDir
    )

    const [first, second] = splitTimelineItem(project.id, item.id, 100, baseDir)

    expect((first.data as { trimBefore?: number }).trimBefore).toBe(45)
    expect((second.data as { trimBefore?: number }).trimBefore).toBe(145)
  })

  it('leaves an image item\'s data untouched on both halves', () => {
    const project = createProject('Split Image', baseDir)
    const item = addTimelineItem(
      project.id,
      { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } },
      baseDir
    )

    const [first, second] = splitTimelineItem(project.id, item.id, 30, baseDir)

    expect(first.data).toEqual({ src: '/a.png' })
    expect(second.data).toEqual({ src: '/a.png' })
  })

  it('shifts later items so the timeline stays back-to-back', () => {
    const project = createProject('Split Resequence', baseDir)
    const first = addTimelineItem(
      project.id,
      { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } },
      baseDir
    )
    const later = addTimelineItem(
      project.id,
      { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } },
      baseDir
    )

    splitTimelineItem(project.id, first.id, 40, baseDir)

    const timeline = readTimeline(project.id, baseDir)
    expect(timeline.map((i) => i.start)).toEqual([0, 40, 90])
    expect(timeline[2].id).toBe(later.id)
  })

  it('rejects a split at the very start or end of the item', () => {
    const project = createProject('Split Bounds', baseDir)
    const item = addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 300, data: { src: '/v.webm' } },
      baseDir
    )

    expect(() => splitTimelineItem(project.id, item.id, 0, baseDir)).toThrow(
      `Cannot split timeline item ${item.id} at frame 0`
    )
    expect(() => splitTimelineItem(project.id, item.id, 300, baseDir)).toThrow(
      `Cannot split timeline item ${item.id} at frame 300`
    )
  })

  it('throws a clear error when the timeline item does not exist', () => {
    const project = createProject('Split Missing', baseDir)

    expect(() => splitTimelineItem(project.id, 'does-not-exist', 10, baseDir)).toThrow(
      'No timeline item found with id does-not-exist'
    )
  })
})

describe('deleteTranscriptSegment', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('removes only the named segment', () => {
    const project = createProject('Delete Segment', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const first = addTranscriptSegment(project.id, { text: 'One', timelineItemId: item.id }, baseDir)
    const second = addTranscriptSegment(project.id, { text: 'Two', timelineItemId: item.id }, baseDir)

    deleteTranscriptSegment(project.id, first.id, baseDir)

    const remaining = readTranscript(project.id, baseDir)
    expect(remaining.map((s) => s.id)).toEqual([second.id])
  })

  it('throws a clear error when the segment does not exist', () => {
    const project = createProject('Delete Missing', baseDir)

    expect(() => deleteTranscriptSegment(project.id, 'does-not-exist', baseDir)).toThrow(
      'No transcript segment found with id does-not-exist'
    )
  })
})

describe('listProjectOverviews', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('summarises an empty project', () => {
    const project = createProject('Empty', baseDir)

    expect(listProjectOverviews(baseDir)).toEqual([
      {
        id: project.id,
        name: 'Empty',
        createdAt: project.createdAt,
        clipCount: 0,
        durationFrames: 0,
        narratedCount: 0
      }
    ])
  })

  it('counts clips, total length and narrated clips', () => {
    const project = createProject('Counted', baseDir)
    const first = addTimelineItem(
      project.id,
      { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } },
      baseDir
    )
    addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Words', timelineItemId: first.id }, baseDir)
    updateTranscriptSegmentAudio(project.id, segment.id, `${segment.id}.wav`, 'Samantha', baseDir)

    const [overview] = listProjectOverviews(baseDir)

    expect(overview.clipCount).toBe(2)
    expect(overview.durationFrames).toBe(150)
    expect(overview.narratedCount).toBe(1)
  })

  it('offers the first clip as the poster', () => {
    const project = createProject('Poster', baseDir)
    addTimelineItem(
      project.id,
      { kind: 'video', start: 0, duration: 300, data: { src: '/v.mp4', trimBefore: 45 } },
      baseDir
    )

    const [overview] = listProjectOverviews(baseDir)

    expect(overview.posterPath).toBe('/v.mp4')
    expect(overview.posterKind).toBe('video')
    expect(overview.posterTrimBefore).toBe(45)
  })

  it('still lists a project whose timeline cannot be read', () => {
    const project = createProject('Broken', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    writeFileSync(join(dir, 'timeline.json'), 'not json at all', 'utf-8')

    const [overview] = listProjectOverviews(baseDir)

    expect(overview.name).toBe('Broken')
    expect(overview.clipCount).toBe(0)
  })
})

describe('deleteTimelineItem', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('removes the clip and closes the gap it left', () => {
    const project = createProject('Delete Clip', baseDir)
    const first = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const second = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)
    const third = addTimelineItem(project.id, { kind: 'image', start: 150, duration: 30, data: { src: '/c.png' } }, baseDir)

    const remaining = deleteTimelineItem(project.id, second.id, baseDir)

    expect(remaining.map((item) => item.id)).toEqual([first.id, third.id])
    expect(remaining.map((item) => item.start)).toEqual([0, 90])
  })

  it('removes the narration that belonged to the clip', () => {
    const project = createProject('Delete Clip Narration', baseDir)
    const doomed = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const kept = addTimelineItem(project.id, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)
    addTranscriptSegment(project.id, { text: 'About the first', timelineItemId: doomed.id }, baseDir)
    const keptSegment = addTranscriptSegment(project.id, { text: 'About the second', timelineItemId: kept.id }, baseDir)

    deleteTimelineItem(project.id, doomed.id, baseDir)

    expect(readTranscript(project.id, baseDir).map((s) => s.id)).toEqual([keptSegment.id])
  })

  it('can empty the timeline completely', () => {
    const project = createProject('Delete Last Clip', baseDir)
    const only = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)

    expect(deleteTimelineItem(project.id, only.id, baseDir)).toEqual([])
  })

  it('throws a clear error when the clip does not exist', () => {
    const project = createProject('Delete Missing Clip', baseDir)

    expect(() => deleteTimelineItem(project.id, 'does-not-exist', baseDir)).toThrow(
      'No timeline item found with id does-not-exist'
    )
  })
})

describe('sweepUnusedNarrationAudio', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('keeps audio the transcript still points at and deletes the rest', () => {
    const project = createProject('Sweep', baseDir)
    const item = addTimelineItem(project.id, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
    const segment = addTranscriptSegment(project.id, { text: 'Words', timelineItemId: item.id }, baseDir)
    updateTranscriptSegmentAudio(project.id, segment.id, 'keep-me.wav', 'Samantha', baseDir)

    const dir = findProjectDir(project.id, baseDir) as string
    writeFileSync(join(dir, 'audio', 'keep-me.wav'), 'current take')
    writeFileSync(join(dir, 'audio', 'older-take.wav'), 'superseded take')

    sweepUnusedNarrationAudio(project.id, baseDir)

    expect(existsSync(join(dir, 'audio', 'keep-me.wav'))).toBe(true)
    expect(existsSync(join(dir, 'audio', 'older-take.wav'))).toBe(false)
  })

  it('leaves everything alone when the transcript cannot be read', () => {
    const project = createProject('Sweep Broken', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string
    writeFileSync(join(dir, 'audio', 'some-take.wav'), 'audio')
    writeFileSync(join(dir, 'transcript.json'), 'not json', 'utf-8')

    sweepUnusedNarrationAudio(project.id, baseDir)

    expect(existsSync(join(dir, 'audio', 'some-take.wav'))).toBe(true)
  })
})

describe('deleteProject', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'demo-editor-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('removes the project and everything in it', () => {
    const project = createProject('Doomed', baseDir)
    const dir = findProjectDir(project.id, baseDir) as string

    deleteProject(project.id, baseDir)

    expect(existsSync(dir)).toBe(false)
  })

  it('leaves the other projects alone', () => {
    const doomed = createProject('Doomed', baseDir)
    const kept = createProject('Kept', baseDir)

    deleteProject(doomed.id, baseDir)

    expect(listProjects(baseDir).map((p) => p.id)).toEqual([kept.id])
  })

  it('throws a clear error when the project does not exist', () => {
    expect(() => deleteProject('does-not-exist', baseDir)).toThrow(
      'No project found with id does-not-exist'
    )
  })
})

describe('a project that speaks in its own voice', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-project-voice-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('starts with none, so it follows the one set in the app', () => {
    expect(createProject('Fresh', baseDir).voice).toBeUndefined()
  })

  it('keeps the voice it is given', () => {
    const project = createProject('Pinned', baseDir)

    setProjectVoice(project.id, 'Rishi', baseDir)

    expect(openProject(project.id, baseDir).voice).toBe('Rishi')
  })

  it('lets a project go back to following the app', () => {
    const project = createProject('Released', baseDir)
    setProjectVoice(project.id, 'Rishi', baseDir)

    setProjectVoice(project.id, null, baseDir)

    expect(openProject(project.id, baseDir).voice).toBeUndefined()
  })

  it('treats blank as following the app, not as a voice called nothing', () => {
    const project = createProject('Blank', baseDir)

    setProjectVoice(project.id, '   ', baseDir)

    expect(openProject(project.id, baseDir).voice).toBeUndefined()
  })

  it('leaves the rest of the project alone', () => {
    const project = createProject('Intact', baseDir)

    setProjectVoice(project.id, 'Daniel', baseDir)

    const after = openProject(project.id, baseDir)
    expect(after.name).toBe('Intact')
    expect(after.id).toBe(project.id)
    expect(after.createdAt).toBe(project.createdAt)
  })

  it('refuses a project that is not there', () => {
    expect(() => setProjectVoice('no-such-project', 'Rishi', baseDir)).toThrow('no-such-project')
  })
})
