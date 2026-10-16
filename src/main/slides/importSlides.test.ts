import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject, readTimeline, readTranscript, addTimelineItem } from '../project/projectApi'
import { prepareDeck, saveSlides } from './importSlides'

const DECK = join(__dirname, 'fixtures', 'two-slides-with-notes.pptx')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('saveSlides', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-slides-test-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('puts one clip on the timeline per slide, in order', () => {
    const project = createProject('Deck', baseDir)

    const added = saveSlides(project.id, [{ png: PNG }, { png: PNG }], [], baseDir)

    expect(added).toHaveLength(2)
    const timeline = readTimeline(project.id, baseDir)
    expect(timeline).toHaveLength(2)
    expect(timeline[1].start).toBe(timeline[0].start + timeline[0].duration)
  })

  it('writes the slide images into the project', () => {
    const project = createProject('Deck', baseDir)

    saveSlides(project.id, [{ png: PNG }], [], baseDir)

    const src = (readTimeline(project.id, baseDir)[0].data as { src: string }).src
    expect(existsSync(src)).toBe(true)
    expect(readFileSync(src)).toEqual(Buffer.from(PNG))
  })

  it('turns speaker notes into that slide\'s narration', () => {
    const project = createProject('Deck', baseDir)

    const added = saveSlides(project.id, [{ png: PNG }, { png: PNG }], ['First words', 'Second words'], baseDir)

    const transcript = readTranscript(project.id, baseDir)
    expect(transcript.find((s) => s.timelineItemId === added[0].id)?.text).toBe('First words')
    expect(transcript.find((s) => s.timelineItemId === added[1].id)?.text).toBe('Second words')
  })

  it('marks notes as the user\'s words so the agent will not overwrite them', () => {
    const project = createProject('Deck', baseDir)

    saveSlides(project.id, [{ png: PNG }], ['My script'], baseDir)

    // 'edited' is what draftNarrationForItem refuses to replace without being forced.
    expect(readTranscript(project.id, baseDir)[0].status).toBe('edited')
  })

  it('leaves a slide with no notes silent rather than inventing narration', () => {
    const project = createProject('Deck', baseDir)

    saveSlides(project.id, [{ png: PNG }, { png: PNG }], ['Only the first', '   '], baseDir)

    expect(readTranscript(project.id, baseDir)).toHaveLength(1)
  })

  it('appends after whatever is already on the timeline', () => {
    const project = createProject('Deck', baseDir)
    addTimelineItem(project.id, { kind: 'image', start: 0, duration: 120, data: { src: '/a.png' } }, baseDir)

    const added = saveSlides(project.id, [{ png: PNG }], [], baseDir)

    expect(added[0].start).toBe(120)
  })

  it('refuses a project that does not exist', () => {
    expect(() => saveSlides('nope', [{ png: PNG }], [], baseDir)).toThrow('No project found with id nope')
  })
})

describe('prepareDeck', () => {
  it('reads a pdf straight through, since it needs no conversion', async () => {
    const pdfPath = join(__dirname, 'fixtures', 'two-pages.pdf')
    if (!existsSync(pdfPath)) return

    const prepared = await prepareDeck(pdfPath)

    expect(prepared.status).toBe('ready')
    if (prepared.status === 'ready') {
      // PDFs start with %PDF.
      expect(Buffer.from(prepared.pdf.slice(0, 4)).toString()).toBe('%PDF')
    }
  })

  it('keeps the speaker notes even when it cannot render the slides', async () => {
    const prepared = await prepareDeck(DECK)

    // On a machine with LibreOffice this converts instead; both paths must carry the notes.
    expect(prepared.status === 'ready' || prepared.status === 'needs-pdf').toBe(true)
    if (prepared.status !== 'cancelled') {
      expect(prepared.notes[0]).toContain('Welcome to Talkie')
    }
  }, 200_000)
})
