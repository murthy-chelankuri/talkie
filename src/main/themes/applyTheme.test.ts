import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { addScene, addTranscriptSegment, createProject, openProject, readTimeline, readTranscript } from '../project/projectApi'
import { createVersion, leftOutNow, setClipIncluded } from '../project/versionsStore'
import { createTheme } from './themeApi'
import { defaultThemeDraft } from './schema'
import { setProjectTheme, themeHighlight } from './applyTheme'
import { findProjectDir } from '../project/paths'

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-apply-theme-'))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

type CardData = { card?: string; layout?: string; params?: { title?: string }; style?: { theme?: string }; src?: string }

/** Each clip as what it is: a theme's card by which, a classic slide by its layout. */
const shapes = (projectId: string): string[] =>
  readTimeline(projectId, baseDir).map((item) => {
    const data = item.data as CardData
    return item.kind === 'html' && data.card ? `${data.card} card` : (data.layout ?? item.kind)
  })

const cardTitle = (projectId: string, index: number): string | undefined =>
  (readTimeline(projectId, baseDir)[index].data as CardData).params?.title

function acme(): string {
  return createTheme({ ...defaultThemeDraft('Acme'), company: 'Acme', tagline: 'Payments, simply' }, baseDir).id
}

/** A project themed before the cards were HTML: classic slides with the card layouts. */
function withClassicCards(closingTitle: string) {
  const project = createProject('Launch video', baseDir)
  const card = { bullets: [], style: { theme: 'brand', align: 'center' } }
  const opening = addScene(project.id, 'scene', { ...card, title: 'Launch <b>video</b>', layout: 'title' }, baseDir)
  const middle = addScene(project.id, 'scene', { title: 'The middle' }, baseDir)
  const closing = addScene(project.id, 'scene', { ...card, title: closingTitle, layout: 'closing' }, baseDir)
  return { project, opening, middle, closing }
}

describe('giving a project a theme', () => {
  it('records the theme against the project', () => {
    const project = createProject('Launch video', baseDir)
    const themeId = acme()

    expect(setProjectTheme(project.id, themeId, baseDir).themeId).toBe(themeId)
    expect(openProject(project.id, baseDir).themeId).toBe(themeId)
  })

  it('opens the video with an HTML card and closes it with one, the first time', () => {
    const project = createProject('Launch video', baseDir)
    addScene(project.id, 'scene', { title: 'The middle' }, baseDir)

    setProjectTheme(project.id, acme(), baseDir)

    expect(shapes(project.id)).toEqual(['opening card', 'standard', 'closing card'])
    expect(cardTitle(project.id, 0)).toBe('Launch video')
    // Untitled, so it says whatever tagline the theme has when it is drawn.
    expect(cardTitle(project.id, 2)).toBe('')
    const timeline = readTimeline(project.id, baseDir)
    expect(timeline[0].start).toBe(0)
    expect(existsSync((timeline[0].data as CardData).src!)).toBe(true)
  })

  it('never adds the cards a second time, whatever theme comes next', () => {
    const project = createProject('Launch video', baseDir)
    setProjectTheme(project.id, acme(), baseDir)

    setProjectTheme(project.id, acme(), baseDir)
    setProjectTheme(project.id, null, baseDir)
    setProjectTheme(project.id, acme(), baseDir)

    expect(shapes(project.id)).toEqual(['opening card', 'closing card'])
  })

  it('keeps the cards when the theme is taken away, since they are the project’s own clips now', () => {
    const project = createProject('Launch video', baseDir)
    setProjectTheme(project.id, acme(), baseDir)

    const plain = setProjectTheme(project.id, null, baseDir)

    expect(plain.themeId).toBeUndefined()
    expect(shapes(project.id)).toEqual(['opening card', 'closing card'])
  })

  it('refuses a theme that does not exist, rather than pointing at nothing', () => {
    const project = createProject('Launch video', baseDir)

    expect(() => setProjectTheme(project.id, 'nope', baseDir)).toThrow(/No theme found/)
  })
})

describe('cards from before they were HTML', () => {
  it('are made HTML cards when a theme is applied, where they stand and with their words', () => {
    const { project, opening, middle, closing } = withClassicCards('Thanks for watching')

    setProjectTheme(project.id, acme(), baseDir)

    expect(shapes(project.id)).toEqual(['opening card', 'standard', 'closing card'])
    expect(readTimeline(project.id, baseDir).map((item) => item.id)).toEqual([opening.id, middle.id, closing.id])
    expect(cardTitle(project.id, 0)).toBe('Launch video')
    expect(cardTitle(project.id, 2)).toBe('Thanks for watching')
    expect((readTimeline(project.id, baseDir)[0].data as CardData).style?.theme).toBe('brand')
  })

  it('keep their narration, their length, and the versions that leave them out', () => {
    const { project, opening, closing } = withClassicCards('Thanks for watching')
    addTranscriptSegment(project.id, { text: 'Welcome.', timelineItemId: opening.id }, baseDir)
    createVersion(project.id, 'Short', baseDir)
    setClipIncluded(project.id, closing.id, false, baseDir)

    setProjectTheme(project.id, acme(), baseDir)

    expect(readTranscript(project.id, baseDir)[0].timelineItemId).toBe(opening.id)
    expect(readTimeline(project.id, baseDir)[0].duration).toBe(opening.duration)
    expect(leftOutNow(project.id, baseDir)).toEqual([closing.id])
  })

  it('leave a closing card that only said the old theme’s tagline to follow the new one', () => {
    const { project } = withClassicCards('An older tagline')
    const older = createTheme({ ...defaultThemeDraft('Older'), company: 'Older', tagline: 'An older tagline' }, baseDir).id
    // The classic card was made under that theme; this applies the next one.
    setProjectThemeRaw(project.id, older)

    setProjectTheme(project.id, acme(), baseDir)

    expect(cardTitle(project.id, 2)).toBe('')
  })

  it('are left alone in a project that has no theme', () => {
    const { project } = withClassicCards('Thanks for watching')

    setProjectTheme(project.id, null, baseDir)

    expect(shapes(project.id)).toEqual(['title', 'standard', 'closing'])
  })
})

/** Points the project at a theme as an older Talkie did, without the cards being touched. */
function setProjectThemeRaw(projectId: string, themeId: string): void {
  const path = join(findProjectDir(projectId, baseDir)!, 'project.json')
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf-8')), themeId, bookendsAdded: true }))
}

describe('the click highlight in a themed project', () => {
  it('is the theme’s, so new recordings match the brand', () => {
    const project = createProject('Launch video', baseDir)
    const draft = defaultThemeDraft('Acme')
    draft.overlays.highlight = '#ff5500'
    setProjectTheme(project.id, createTheme(draft, baseDir).id, baseDir)

    expect(themeHighlight(project.id, baseDir)).toBe('#ff5500')
  })

  it('is left to Settings in a project without one', () => {
    expect(themeHighlight(createProject('Plain', baseDir).id, baseDir)).toBeNull()
  })
})
