import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { addScene, createProject, openProject, readTimeline } from '../project/projectApi'
import { createTheme } from './themeApi'
import { defaultThemeDraft } from './schema'
import { setProjectTheme, themeHighlight } from './applyTheme'

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-apply-theme-'))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

const layouts = (projectId: string): string[] =>
  readTimeline(projectId, baseDir).map((item) => (item.data as { layout?: string }).layout ?? item.kind)

function acme(): string {
  return createTheme({ ...defaultThemeDraft('Acme'), company: 'Acme', tagline: 'Payments, simply' }, baseDir).id
}

describe('giving a project a theme', () => {
  it('records the theme against the project', () => {
    const project = createProject('Launch video', baseDir)
    const themeId = acme()

    expect(setProjectTheme(project.id, themeId, baseDir).themeId).toBe(themeId)
    expect(openProject(project.id, baseDir).themeId).toBe(themeId)
  })

  it('opens the video with a title card and closes it with one, the first time', () => {
    const project = createProject('Launch video', baseDir)
    addScene(project.id, 'scene', { title: 'The middle' }, baseDir)

    setProjectTheme(project.id, acme(), baseDir)

    expect(layouts(project.id)).toEqual(['title', 'standard', 'closing'])
    const timeline = readTimeline(project.id, baseDir)
    expect((timeline[0].data as { title: string }).title).toBe('Launch video')
    expect((timeline[2].data as { title: string }).title).toBe('Payments, simply')
    expect(timeline[0].start).toBe(0)
  })

  it('never adds the cards a second time, whatever theme comes next', () => {
    const project = createProject('Launch video', baseDir)
    setProjectTheme(project.id, acme(), baseDir)

    setProjectTheme(project.id, acme(), baseDir)
    setProjectTheme(project.id, null, baseDir)
    setProjectTheme(project.id, acme(), baseDir)

    expect(layouts(project.id)).toEqual(['title', 'closing'])
  })

  it('keeps the cards when the theme is taken away, since they are the project’s own clips now', () => {
    const project = createProject('Launch video', baseDir)
    setProjectTheme(project.id, acme(), baseDir)

    const plain = setProjectTheme(project.id, null, baseDir)

    expect(plain.themeId).toBeUndefined()
    expect(layouts(project.id)).toEqual(['title', 'closing'])
  })

  it('closes with the company name when the theme has no tagline', () => {
    const project = createProject('Launch video', baseDir)
    const themeId = createTheme({ ...defaultThemeDraft('Acme'), company: 'Acme' }, baseDir).id

    setProjectTheme(project.id, themeId, baseDir)

    expect((readTimeline(project.id, baseDir)[1].data as { title: string }).title).toBe('Acme')
  })

  it('refuses a theme that does not exist, rather than pointing at nothing', () => {
    const project = createProject('Launch video', baseDir)

    expect(() => setProjectTheme(project.id, 'nope', baseDir)).toThrow(/No theme found/)
  })
})

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
