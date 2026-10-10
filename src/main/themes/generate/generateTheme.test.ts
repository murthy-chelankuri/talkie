import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { NarrationProvider } from '../../agent/narrationProvider'
import type { BrandFacts } from './facts'
import { generateStatus, generateTheme, saveGeneratedTheme } from './generateTheme'
import { findThemeDir, listThemes } from '../themeApi'

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-generate-'))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

const site: BrandFacts = {
  colours: [
    { hex: '#ffffff', weight: 1000, role: 'background' },
    { hex: '#0a2540', weight: 600, role: 'background' },
    { hex: '#635bff', weight: 400, role: 'button' }
  ],
  fonts: [{ family: 'Inter', role: 'body' }],
  logo: { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), fileName: 'logo.svg' },
  sources: ['website'],
  problems: []
}

const template: NarrationProvider = { id: 'template', label: 'Built-in', sendsDataOffMachine: false, isAvailable: async () => ({ available: true }), draft: async () => '' }
const offline = (async () => {
  throw new TypeError('fetch failed')
}) as unknown as typeof fetch

const deps = (overrides = {}) => ({
  readWebsite: async () => site,
  readLogo: async () => site,
  readBrandGuide: async () => site,
  provider: template,
  fetcher: offline,
  baseDir,
  ...overrides
})

describe('making a theme', () => {
  it('turns a website into a draft with its logo waiting beside it, unsaved', async () => {
    const { draft, stagingDir } = await generateTheme({ name: 'Acme', url: 'acme.com' }, deps())

    expect(draft.variants.brand.background).toBe('#635bff')
    expect(draft.logo?.file).toBe('logo.svg')
    expect(existsSync(join(stagingDir, 'logo.svg'))).toBe(true)
    expect(listThemes(baseDir)).toEqual([])
  })

  it('records what it was made from, and anything it had to work around', async () => {
    const { draft } = await generateTheme({ name: 'Acme', url: 'acme.com', description: 'calm fintech' }, deps())

    expect(draft.provenance?.from).toEqual(['website', 'description'])
    expect(draft.provenance?.notes.join(' ')).toMatch(/Inter/)
  })

  it('carries on with the description when the site cannot be read', async () => {
    const failing = deps({ readWebsite: async () => Promise.reject(new Error('it asked for a sign-in')) })

    const { draft } = await generateTheme({ name: 'Acme', url: 'acme.com', description: 'calm fintech, navy and green' }, failing)

    expect(draft.provenance?.notes.join(' ')).toMatch(/sign-in/)
  })

  it('says what went wrong, and what to try, when nothing could be read', async () => {
    const failing = deps({ readWebsite: async () => Promise.reject(new Error('it asked for a sign-in')) })

    await expect(generateTheme({ name: 'Acme', url: 'acme.com' }, failing)).rejects.toThrow(/sign-in.*Try a description or a logo/)
    expect(generateStatus().error).toMatch(/sign-in/)
  })

  it('asks for something to work from', async () => {
    await expect(generateTheme({ name: 'Acme' }, deps())).rejects.toThrow(/website, a description/)
  })

  it('reads a PDF as a brand guide and an image as a logo', async () => {
    const seen: string[] = []
    const watching = deps({
      readLogo: async () => (seen.push('logo'), site),
      readBrandGuide: async () => (seen.push('guide'), site)
    })

    await generateTheme({ name: 'A', file: { bytes: Buffer.from('x'), fileName: 'Guide.PDF' } }, watching)
    await generateTheme({ name: 'B', file: { bytes: Buffer.from('x'), fileName: 'mark.png' } }, watching)

    expect(seen).toEqual(['guide', 'logo'])
  })
})

describe('saving a made theme', () => {
  it('puts it in the library with its files, and clears the draft away', async () => {
    const { draft, stagingDir } = await generateTheme({ name: 'Acme', url: 'acme.com' }, deps())

    const theme = saveGeneratedTheme(draft, stagingDir, baseDir)

    expect(listThemes(baseDir).map((t) => t.id)).toEqual([theme.id])
    expect(readdirSync(findThemeDir(theme.id, baseDir) as string)).toContain('logo.svg')
    expect(existsSync(stagingDir)).toBe(false)
  })
})
