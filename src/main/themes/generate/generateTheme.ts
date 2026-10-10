import { randomUUID } from 'crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { NarrationProvider } from '../../agent/narrationProvider'
import { narrationProvider } from '../../agent/providerRegistry'
import { readSettings } from '../../settings/settingsStore'
import { fixContrast } from '../contrast'
import { createTheme, findThemeDir, themesRootDir, writeAssetInto } from '../themeApi'
import type { Theme, ThemeDraft } from '../schema'
import { NO_FACTS, mergeFacts, type BrandFacts } from './facts'
import { readWebsite as readWebsiteDefault } from './readWebsite'
import { readLogo as readLogoDefault } from './readLogo'
import { readBrandGuide as readBrandGuideDefault } from './readBrandGuide'
import { proposeTheme } from './proposeTheme'
import { resolveFonts } from './resolveFonts'

export interface GenerateRequest {
  name: string
  url?: string
  description?: string
  /** A logo image or a brand-guide PDF. */
  file?: { bytes: Buffer; fileName: string }
}

/** A theme that has been made but not saved: its draft, and the folder its files wait in. */
export interface GeneratedTheme {
  draft: ThemeDraft
  stagingDir: string
}

export interface GenerateStatus {
  running: boolean
  /** What it is doing now, said to the person waiting: "Reading acme.com…" */
  step: string
  error?: string
}

export interface GenerateDeps {
  readWebsite: (url: string) => Promise<BrandFacts>
  readLogo: (bytes: Buffer, fileName: string) => Promise<BrandFacts>
  readBrandGuide: (bytes: Buffer) => Promise<BrandFacts>
  provider: NarrationProvider
  fetcher: typeof fetch
  baseDir: string
}

let status: GenerateStatus = { running: false, step: '' }

export function generateStatus(): GenerateStatus {
  return status
}

/** Drafts nobody saved, left by a window closed mid-way; a day is long enough to come back. */
function sweepOldDrafts(baseDir: string): void {
  const drafts = join(themesRootDir(baseDir), '.drafts')
  if (!existsSync(drafts)) return
  for (const name of readdirSync(drafts)) {
    const dir = join(drafts, name)
    if (Date.now() - statSync(dir).mtimeMs > 24 * 60 * 60 * 1000) rmSync(dir, { recursive: true, force: true })
  }
}

function defaults(): GenerateDeps {
  return {
    readWebsite: (url) => readWebsiteDefault(url),
    readLogo: readLogoDefault,
    readBrandGuide: readBrandGuideDefault,
    provider: narrationProvider(readSettings().narration.provider),
    fetcher: fetch,
    baseDir: homedir()
  }
}

/**
 * Make a theme from whatever the person gave — a website, a description, a logo or a brand
 * guide, in any combination — and leave it as a draft for them to look at before it is saved.
 *
 * Every step that can fail is allowed to: a site that wants a sign-in still leaves the logo and
 * the description to go on. Only when nothing at all could be read is there nothing to make.
 */
export async function generateTheme(request: GenerateRequest, deps: Partial<GenerateDeps> = {}): Promise<GeneratedTheme> {
  const use = { ...defaults(), ...deps }
  const description = request.description?.trim() ?? ''
  if (!request.url?.trim() && !description && !request.file) {
    throw new Error('Give a website, a description, or a logo or brand guide to make a theme from.')
  }
  if (status.running) throw new Error('A theme is already being made. Wait for it to finish.')

  status = { running: true, step: 'Starting…' }
  try {
    sweepOldDrafts(use.baseDir)
    const read: BrandFacts[] = []

    if (request.url?.trim()) {
      const url = request.url.trim()
      status = { running: true, step: `Reading ${url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}…` }
      try {
        read.push(await use.readWebsite(url))
      } catch (err) {
        read.push({ ...NO_FACTS, problems: [`Could not read ${url}: ${err instanceof Error ? err.message : String(err)}`] })
      }
    }

    if (request.file) {
      const isPdf = request.file.fileName.toLowerCase().endsWith('.pdf')
      status = { running: true, step: isPdf ? 'Reading the brand guide…' : 'Reading the logo…' }
      try {
        read.push(isPdf ? await use.readBrandGuide(request.file.bytes) : await use.readLogo(request.file.bytes, request.file.fileName))
      } catch (err) {
        read.push({ ...NO_FACTS, problems: [`Could not read ${request.file.fileName}: ${err instanceof Error ? err.message : String(err)}`] })
      }
    }

    const facts = mergeFacts(NO_FACTS, ...read)
    if (description) facts.sources.push('description')
    if (facts.colours.length === 0 && facts.fonts.length === 0 && !description) {
      throw new Error(`${facts.problems.join(' ')} Try a description or a logo instead.`.trim())
    }

    status = { running: true, step: 'Choosing colours…' }
    const proposal = await proposeTheme(facts, description, request.name, use.provider)

    status = { running: true, step: 'Getting fonts…' }
    const fonts = await resolveFonts(proposal.draft, proposal.fallbacks, use.fetcher)

    status = { running: true, step: 'Checking readability…' }
    const readable = fixContrast(fonts.draft)

    const stagingDir = join(themesRootDir(use.baseDir), '.drafts', randomUUID())
    mkdirSync(stagingDir, { recursive: true })
    for (const file of fonts.files) writeAssetInto(stagingDir, 'font', file.fileName, file.bytes)
    const logo = facts.logo ? writeAssetInto(stagingDir, 'logo', facts.logo.fileName, facts.logo.bytes) : undefined

    const draft: ThemeDraft = {
      ...readable.draft,
      ...(logo ? { logo: { file: logo, corner: 'bottom-right', showOn: { recordings: true, slides: true } } } : {}),
      provenance: {
        from: facts.sources,
        notes: [...facts.problems, ...proposal.notes, ...fonts.notes, ...readable.notes]
      }
    }
    status = { running: false, step: 'Done' }
    return { draft, stagingDir }
  } catch (err) {
    status = { running: false, step: '', error: err instanceof Error ? err.message : String(err) }
    throw err
  }
}

/** Save a draft into the library, taking its waiting files with it. */
export function saveGeneratedTheme(draft: ThemeDraft, stagingDir: string | undefined, baseDir: string = homedir()): Theme {
  const theme = createTheme(draft, baseDir)
  if (stagingDir && existsSync(stagingDir) && stagingDir.startsWith(join(themesRootDir(baseDir), '.drafts'))) {
    cpSync(stagingDir, findThemeDir(theme.id, baseDir) as string, { recursive: true })
    rmSync(stagingDir, { recursive: true, force: true })
  }
  return theme
}
