import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import {
  createTheme,
  deleteTheme,
  findThemeDir,
  listThemes,
  projectsUsingTheme,
  readTheme,
  themesRootDir,
  updateTheme,
  writeThemeAsset
} from './themeApi'
import { defaultThemeDraft } from './schema'
import { createProject } from '../project/projectApi'
import { findProjectDir } from '../project/paths'

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-themes-'))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

describe('the theme library', () => {
  it('keeps themes beside the projects, in ~/Talkie/Themes', () => {
    expect(themesRootDir(baseDir)).toBe(join(baseDir, 'Talkie', 'Themes'))
  })

  it('saves a theme in a folder named for it, and reads it back', () => {
    const theme = createTheme({ ...defaultThemeDraft('Acme Corp'), company: 'Acme' }, baseDir)

    expect(basename(findThemeDir(theme.id, baseDir) as string)).toBe(`${theme.id}-acme-corp`)
    expect(readTheme(theme.id, baseDir)).toEqual(theme)
    expect(listThemes(baseDir).map((t) => t.id)).toEqual([theme.id])
  })

  it('lists the newest first, and passes over a folder it cannot read', () => {
    const first = createTheme(defaultThemeDraft('First'), baseDir)
    const second = createTheme(defaultThemeDraft('Second'), baseDir)
    writeFileSync(join(findThemeDir(first.id, baseDir) as string, '..', 'broken.json'), 'not a theme')
    writeFileSync(join(findThemeDir(first.id, baseDir) as string, 'theme.json'), '{ not json')

    expect(listThemes(baseDir).map((t) => t.id)).toEqual([second.id])
  })

  it('keeps a theme its id and its date when it is edited', () => {
    const theme = createTheme(defaultThemeDraft('Acme'), baseDir)

    const edited = updateTheme(theme.id, { ...defaultThemeDraft('Acme'), tagline: 'Payments, simply' }, baseDir)

    expect(edited.id).toBe(theme.id)
    expect(edited.createdAt).toBe(theme.createdAt)
    expect(readTheme(theme.id, baseDir).tagline).toBe('Payments, simply')
  })

  it('takes its files with it when deleted', () => {
    const theme = createTheme(defaultThemeDraft('Acme'), baseDir)
    const dir = findThemeDir(theme.id, baseDir) as string

    deleteTheme(theme.id, baseDir)

    expect(existsSync(dir)).toBe(false)
    expect(() => readTheme(theme.id, baseDir)).toThrow(/No theme found/)
  })

  it('stores a logo under one name whatever it was called, so a theme has one logo', () => {
    const theme = createTheme(defaultThemeDraft('Acme'), baseDir)

    const path = writeThemeAsset(theme.id, 'logo', 'Acme Logo FINAL.SVG', Buffer.from('<svg/>'), baseDir)

    expect(path).toBe('logo.svg')
    expect(readFileSync(join(findThemeDir(theme.id, baseDir) as string, path), 'utf-8')).toBe('<svg/>')
  })

  it('refuses a file that is not a picture or a font', () => {
    const theme = createTheme(defaultThemeDraft('Acme'), baseDir)

    expect(() => writeThemeAsset(theme.id, 'logo', 'logo.exe', Buffer.from('x'), baseDir)).toThrow(/logo/i)
    expect(() => writeThemeAsset(theme.id, 'font', 'font.svg', Buffer.from('x'), baseDir)).toThrow(/font/i)
  })

  it('refuses a logo too large to carry into every frame', () => {
    const theme = createTheme(defaultThemeDraft('Acme'), baseDir)

    expect(() =>
      writeThemeAsset(theme.id, 'logo', 'logo.png', Buffer.alloc(2 * 1024 * 1024 + 1), baseDir)
    ).toThrow(/2 MB/)
  })

  it('keeps a font under its own name, in fonts/', () => {
    const theme = createTheme(defaultThemeDraft('Acme'), baseDir)

    expect(writeThemeAsset(theme.id, 'font', 'Inter-Bold.woff2', Buffer.from('x'), baseDir)).toBe(
      'fonts/Inter-Bold.woff2'
    )
  })

  it('names the projects that would lose a theme, before it is deleted', () => {
    const theme = createTheme(defaultThemeDraft('Acme'), baseDir)
    const using = createProject('Launch video', baseDir)
    createProject('Something else', baseDir)
    const file = join(findProjectDir(using.id, baseDir) as string, 'project.json')
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf-8')), themeId: theme.id }))

    expect(projectsUsingTheme(theme.id, baseDir)).toEqual([{ id: using.id, name: 'Launch video' }])
  })
})
