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

const ALL = ['bar-chart', 'before-after', 'closing', 'code-walkthrough', 'counter', 'kinetic-title', 'lottie', 'opening', 'quote', 'slide', 'steps', 'timeline']

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

describe('the cards a theme puts at either end', () => {
  /** A logo in the brand's own colour: on the brand ground it would vanish without a plate. */
  function brandLogo(colour: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><rect x="10" y="10" width="380" height="100" rx="20" fill="${colour}"/></svg>`
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  }

  function acme(logoColour?: string) {
    const theme = { ...renderThemeFrom(BUILTIN_THEMES.find((t) => t.id === 'builtin-midnight')!, undefined), company: 'Acme', tagline: 'Payments, simply', website: 'acme.example' }
    return logoColour
      ? { ...theme, logo: { light: brandLogo(logoColour), dark: brandLogo(logoColour), corner: 'top-right' as const, showOn: { recordings: false, slides: true } } }
      : theme
  }

  async function poster(id: string, theme: ReturnType<typeof acme>, params: Record<string, unknown>) {
    const src = writeRevision(projectId, templateFiles(id), { baseDir })
    return checkHtmlScene({ src, durationFrames: 90, theme: sceneThemeFor(theme, 'brand'), rootDir: projectsRootDir(baseDir), params, atSeconds: [1] })
  }

  it('say who the video is from, as the theme has it', async () => {
    const opening = await poster('opening', acme(), { title: 'Launch video' })
    const closing = await poster('closing', acme(), { title: '' })

    expect(opening.visibleText).toMatch(/acme/i)
    expect(opening.visibleText).toContain('Launch video')
    expect(closing.visibleText).toContain('Payments, simply')
    expect(closing.visibleText).toContain('acme.example')
  }, 120_000)

  it('put a logo on a plate where the card’s ground would swallow it, and nowhere else', async () => {
    const brand = acme().variants.brand.background

    const swallowed = await poster('opening', acme(brand), { title: 'Launch video' })
    const readable = await poster('opening', acme('#ffffff'), { title: 'Launch video' })

    expect(swallowed.problems).toEqual([])
    expect(readable.problems).toEqual([])
    // The theme's light ground is the plate a logo on its brand ground gets.
    const plate = acme().variants.light.background
    expect(await colourAtPlateEdge(swallowed.frames[0].png)).toBe(plate)
    expect(await colourAtPlateEdge(readable.frames[0].png)).not.toBe(plate)
  }, 120_000)
})

/** The colour just inside the left end of a plate, where the plate pads the logo — or the logo, unplated. */
async function colourAtPlateEdge(png: Buffer): Promise<string> {
  const { runFfmpeg } = await import('../media')
  const { readFileSync, writeFileSync } = await import('fs')
  const dir = mkdtempSync(join(tmpdir(), 'talkie-plate-'))
  try {
    writeFileSync(join(dir, 'frame.png'), png)
    await runFfmpeg(['-i', join(dir, 'frame.png'), '-vf', 'crop=1:1:700:427', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-y', join(dir, 'pixel.rgb')])
    return '#' + [...readFileSync(join(dir, 'pixel.rgb'))].map((n) => n.toString(16).padStart(2, '0')).join('')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
