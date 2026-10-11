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

describe('the templates', () => {
  it('are six, each with a name and what it is for', () => {
    const templates = listTemplates()

    expect(templates.map((t) => t.id).sort()).toEqual(['bar-chart', 'before-after', 'code-walkthrough', 'counter', 'kinetic-title', 'lottie'])
    for (const template of templates) expect(template.description, template.id).not.toBe('')
  })

  for (const id of ['bar-chart', 'before-after', 'code-walkthrough', 'counter', 'kinetic-title', 'lottie']) {
    it(`${id} draws cleanly in a dark theme and a light one`, async () => {
      const src = writeRevision(projectId, templateFiles(id), { baseDir })
      for (const [themeId, variant] of [['builtin-midnight', 'dark'], ['builtin-daylight', 'light']] as const) {
        const theme = renderThemeFrom(BUILTIN_THEMES.find((t) => t.id === themeId)!, undefined)
        const result = await checkHtmlScene({ src, durationFrames: 180, theme: sceneThemeFor(theme, variant), rootDir: projectsRootDir(baseDir), atSeconds: [0.2, 3, 5.9] })

        expect({ id, themeId, problems: result.problems }).toEqual({ id, themeId, problems: [] })
      }
    }, 180_000)
  }
})
