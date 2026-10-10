import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { BUILTIN_THEMES, builtinDescription, isBuiltinThemeId } from './builtinThemes'
import { fixContrast } from './contrast'
import {
  createTheme,
  deleteTheme,
  duplicateTheme,
  findThemeDir,
  listThemes,
  readTheme,
  updateTheme,
  writeAssetInto,
  writeThemeAsset
} from './themeApi'
import { BUILTIN_FONTS, defaultThemeDraft } from './schema'
import { toRenderTheme } from './toRenderTheme'

let baseDir: string
beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-builtin-themes-'))
})
afterEach(() => rmSync(baseDir, { recursive: true, force: true }))

describe('the themes Talkie comes with', () => {
  it('include both dark and light looks', () => {
    const dark = BUILTIN_THEMES.filter((t) => luminanceOf(t.variants.brand.background) < 0.2)
    const light = BUILTIN_THEMES.filter((t) => luminanceOf(t.variants.brand.background) > 0.6)

    expect(dark.length).toBeGreaterThanOrEqual(2)
    expect(light.length).toBeGreaterThanOrEqual(2)
  })

  it('can all be read without a single colour needing a fix', () => {
    for (const theme of BUILTIN_THEMES) {
      expect({ theme: theme.name, notes: fixContrast(theme).notes }).toEqual({ theme: theme.name, notes: [] })
    }
  })

  it('use only the fonts every render already has, so they work offline', () => {
    const families = new Set<string>(Object.values(BUILTIN_FONTS))
    for (const theme of BUILTIN_THEMES) {
      for (const font of [theme.fonts.heading, theme.fonts.body]) {
        expect(families.has(font.family) && font.source === 'builtin' && font.files.length === 0).toBe(true)
      }
    }
  })

  it('leave the closing card to the person, with no tagline or company of their own', () => {
    for (const theme of BUILTIN_THEMES) {
      expect([theme.tagline, theme.company, theme.website]).toEqual(['', '', ''])
      expect(builtinDescription(theme.id)).toBeTruthy()
    }
  })

  it('are listed after the person’s own, even in an empty library', () => {
    expect(listThemes(baseDir).map((t) => t.id)).toEqual(BUILTIN_THEMES.map((t) => t.id))

    const own = createTheme(defaultThemeDraft('Acme'), baseDir)

    expect(listThemes(baseDir)[0].id).toBe(own.id)
    expect(listThemes(baseDir).filter((t) => isBuiltinThemeId(t.id))).toHaveLength(BUILTIN_THEMES.length)
  })

  it('draw a project like any other theme', () => {
    const theme = toRenderTheme('builtin-midnight', baseDir)

    expect(theme?.variants.brand.background).toBe('#0b1f3a')
    expect(theme?.logo).toBeUndefined()
  })

  it('cannot be deleted, edited, or given files', () => {
    const id = BUILTIN_THEMES[0].id

    expect(() => deleteTheme(id, baseDir)).toThrow(/cannot be changed or deleted/)
    expect(() => updateTheme(id, { ...BUILTIN_THEMES[0], name: 'Mine now' }, baseDir)).toThrow(/cannot be changed/)
    expect(() => writeThemeAsset(id, 'logo', 'logo.svg', Buffer.from('<svg/>'), baseDir)).toThrow(/cannot be changed/)
    expect(findThemeDir(id, baseDir)).toBeUndefined()
    expect(readTheme(id, baseDir).name).toBe(BUILTIN_THEMES[0].name)
  })

  it('are made your own by duplicating, which gives a copy that can be changed', () => {
    const copy = duplicateTheme('builtin-sand', baseDir)

    expect(copy.name).toBe('Sand copy')
    expect(isBuiltinThemeId(copy.id)).toBe(false)
    expect(copy.variants).toEqual(readTheme('builtin-sand', baseDir).variants)
    expect(updateTheme(copy.id, { ...copy, name: 'Our look' }, baseDir).name).toBe('Our look')
    expect(readTheme('builtin-sand', baseDir).name).toBe('Sand')
  })
})

describe('duplicating one of your own themes', () => {
  it('brings its logo and fonts with it, as files of its own', () => {
    const source = createTheme(defaultThemeDraft('Acme'), baseDir)
    const dir = findThemeDir(source.id, baseDir) as string
    const logo = writeAssetInto(dir, 'logo', 'mark.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))
    writeAssetInto(dir, 'font', 'Acme-400.woff2', Buffer.from('font'))
    updateTheme(source.id, { ...source, logo: { file: logo, corner: 'top-right', showOn: { recordings: true, slides: true } } }, baseDir)

    const copy = duplicateTheme(source.id, baseDir)
    const copyDir = findThemeDir(copy.id, baseDir) as string
    deleteTheme(source.id, baseDir)

    expect(copy.logo?.file).toBe('logo.svg')
    expect(readdirSync(copyDir).sort()).toEqual(['fonts', 'logo.svg', 'theme.json'])
    expect(readdirSync(join(copyDir, 'fonts'))).toEqual(['Acme-400.woff2'])
    expect(toRenderTheme(copy.id, baseDir)?.logo?.url).toMatch(/^data:image\/svg\+xml/)
  })
})

function luminanceOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const linear = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}
