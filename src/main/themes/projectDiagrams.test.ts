import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { addScene, createProject, readTimeline } from '../project/projectApi'
import { findProjectDir } from '../project/paths'
import { createTheme } from './themeApi'
import { defaultThemeDraft } from './schema'
import { redrawStaleDiagrams } from './projectDiagrams'
import { toRenderTheme } from './toRenderTheme'
import { diagramStamp } from './diagrams'

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-project-diagrams-'))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

function useTheme(projectId: string, themeId: string): void {
  const file = join(findProjectDir(projectId, baseDir) as string, 'project.json')
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf-8')), themeId }))
}

describe('redrawing diagrams for a theme', () => {
  it('draws a diagram again in the project’s theme, and stamps it with that theme', async () => {
    const draft = defaultThemeDraft('Acme')
    draft.variants.dark.accent = '#ff5500'
    const theme = createTheme(draft, baseDir)
    const project = createProject('Themed', baseDir)
    addScene(project.id, 'diagram', { source: 'flowchart LR\n  A[One] --> B[Two]', src: '/old.svg' }, baseDir)
    useTheme(project.id, theme.id)

    expect(await redrawStaleDiagrams(project.id, baseDir)).toBe(1)

    const data = readTimeline(project.id, baseDir)[0].data as { src: string; themeStamp: string }
    expect(data.themeStamp).toBe(diagramStamp(toRenderTheme(theme.id, baseDir)!, 'dark'))
    expect(readFileSync(data.src, 'utf-8')).toContain('#ff5500')
  }, 90_000)

  it('leaves a project with no theme, and diagrams drawn before themes, alone', async () => {
    const project = createProject('Plain', baseDir)
    addScene(project.id, 'diagram', { source: 'flowchart LR\n  A --> B', src: '/old.svg' }, baseDir)

    expect(await redrawStaleDiagrams(project.id, baseDir)).toBe(0)
    expect((readTimeline(project.id, baseDir)[0].data as { src: string }).src).toBe('/old.svg')
  })
})
