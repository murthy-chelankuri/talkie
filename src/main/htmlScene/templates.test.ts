import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../project/projectApi'
import { projectsRootDir } from '../project/paths'
import { closeAssetServer } from '../render/assetServer'
import { BUILTIN_THEMES } from '../themes/builtinThemes'
import { renderThemeFrom } from '../themes/toRenderTheme'
import { checkHtmlScene, sceneThemeFor } from './check'
import { listTemplates, templateFiles } from './templates'
import { writeRevision } from './store'

let baseDir: string
let projectId: string
beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-html-templates-'))
  projectId = createProject('Templates', baseDir).id
})
afterAll(async () => {
  await closeAssetServer()
  rmSync(baseDir, { recursive: true, force: true })
})

const ALL = ['bar-chart', 'before-after', 'code-walkthrough', 'counter', 'kinetic-title', 'lottie', 'quote', 'slide', 'steps', 'timeline']

describe('the templates', () => {
  it('each have a name, what they are for, where they belong, and the values a scene starts with', () => {
    const templates = listTemplates()

    expect(templates.map((t) => t.id).sort()).toEqual(ALL)
    for (const template of templates) {
      expect(template.description, template.id).not.toBe('')
      expect(['Slides', 'Diagrams', 'Data', 'Motion', 'Code'], template.id).toContain(template.category)
      // A scene starts with these; with none, its form said there was nothing to change.
      expect(Object.keys(template.values).length, template.id).toBeGreaterThan(0)
    }
  })

  it('keep the gallery picture out of the scene made from them', () => {
    for (const id of ALL) expect(Object.keys(templateFiles(id)), id).not.toContain('thumbnail.png')
  })

  for (const id of ALL) {
    it(`${id} draws cleanly in a dark theme and a light one, with the values it starts with`, async () => {
      const src = writeRevision(projectId, templateFiles(id), { baseDir })
      const params = listTemplates().find((t) => t.id === id)!.values
      for (const [themeId, variant] of [['builtin-midnight', 'dark'], ['builtin-daylight', 'light']] as const) {
        const theme = renderThemeFrom(BUILTIN_THEMES.find((t) => t.id === themeId)!, undefined)
        const result = await checkHtmlScene({ src, durationFrames: 180, theme: sceneThemeFor(theme, variant), rootDir: projectsRootDir(baseDir), params, atSeconds: [0.2, 3, 5.9] })

        expect({ id, themeId, problems: result.problems }).toEqual({ id, themeId, problems: [] })
      }
    }, 180_000)
  }
})
