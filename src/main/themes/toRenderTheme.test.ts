import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTheme, findThemeDir, updateTheme, writeThemeAsset } from './themeApi'
import { defaultThemeDraft } from './schema'
import { toRenderTheme } from './toRenderTheme'

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-render-theme-'))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

describe('a theme as the video receives it', () => {
  it('is nothing at all for a project without one', () => {
    expect(toRenderTheme(undefined, baseDir)).toBeNull()
    expect(toRenderTheme('no-such-theme', baseDir)).toBeNull()
  })

  it('carries its logo inside it, so nothing has to be fetched while rendering', () => {
    const theme = createTheme(defaultThemeDraft('Acme'), baseDir)
    const file = writeThemeAsset(theme.id, 'logo', 'logo.svg', Buffer.from('<svg/>'), baseDir)
    updateTheme(theme.id, { ...defaultThemeDraft('Acme'), logo: { file, corner: 'top-left', showOn: { recordings: true, slides: false } } }, baseDir)

    const rendered = toRenderTheme(theme.id, baseDir)

    expect(rendered?.logo?.url).toBe(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`)
    expect(rendered?.logo?.corner).toBe('top-left')
    expect(rendered?.logo?.showOn.slides).toBe(false)
  })

  it('carries its fonts inside it too', () => {
    const theme = createTheme(defaultThemeDraft('Acme'), baseDir)
    const file = writeThemeAsset(theme.id, 'font', 'Inter.woff2', Buffer.from('font'), baseDir)
    updateTheme(
      theme.id,
      { ...defaultThemeDraft('Acme'), fonts: { heading: { family: 'Inter', files: [file], source: 'google' }, body: { family: 'Inter', files: [file], source: 'google' } } },
      baseDir
    )

    const rendered = toRenderTheme(theme.id, baseDir)

    expect(rendered?.fonts.heading.family).toBe('Inter')
    expect(rendered?.fonts.heading.urls).toEqual([`data:font/woff2;base64,${Buffer.from('font').toString('base64')}`])
  })

  it('draws without a logo whose file has gone, rather than failing the video', () => {
    const theme = createTheme({ ...defaultThemeDraft('Acme'), logo: { file: 'logo.png', corner: 'bottom-right', showOn: { recordings: true, slides: true } } }, baseDir)

    expect(toRenderTheme(theme.id, baseDir)?.logo).toBeUndefined()
  })

  it('falls back to Talkie’s own type when fonts are too large to carry into every frame', () => {
    const theme = createTheme(defaultThemeDraft('Acme'), baseDir)
    const dir = findThemeDir(theme.id, baseDir) as string
    writeFileSync(join(dir, 'fonts', 'Huge.ttf'), Buffer.alloc(3 * 1024 * 1024 + 1))
    updateTheme(
      theme.id,
      { ...defaultThemeDraft('Acme'), fonts: { heading: { family: 'Huge', files: ['fonts/Huge.ttf'], source: 'user' }, body: { family: 'Geist Variable', files: [], source: 'builtin' } } },
      baseDir
    )

    const rendered = toRenderTheme(theme.id, baseDir)

    expect(rendered?.fonts.heading).toEqual({ family: 'Newsreader Variable', urls: [] })
  })

  it('changes its stamp when its colours change, and only then', () => {
    const theme = createTheme(defaultThemeDraft('Acme'), baseDir)
    const before = toRenderTheme(theme.id, baseDir)?.stamp

    updateTheme(theme.id, { ...defaultThemeDraft('Acme'), tagline: 'New words' }, baseDir)
    expect(toRenderTheme(theme.id, baseDir)?.stamp).toBe(before)

    const recoloured = defaultThemeDraft('Acme')
    recoloured.variants.dark.accent = '#ff8800'
    updateTheme(theme.id, recoloured, baseDir)
    expect(toRenderTheme(theme.id, baseDir)?.stamp).not.toBe(before)
  })
})
