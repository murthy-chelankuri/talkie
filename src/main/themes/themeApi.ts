import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, extname, join } from 'path'
import { writeJsonAtomic } from '../project/atomicWrite'
import { slugify } from '../project/slug'
import { ROOT_NAME } from '../project/migrateStorageRoot'
import { listProjects, openProject } from '../project/projectApi'
import { THEME_SCHEMA_VERSION, ThemeDraftSchema, ThemeSchema, type Theme, type ThemeDraft } from './schema'

/**
 * The theme library: one folder per theme, beside the projects.
 *
 * A library rather than a copy inside each project, so the second video for a company looks like
 * the first without anyone re-making anything — and correcting a colour corrects it everywhere.
 */

/** Carried into every frame as a data URL; much more than this and the render slows to a crawl. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024

const LOGO_TYPES = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])
const FONT_TYPES = new Set(['.woff2', '.woff', '.ttf', '.otf'])

export function themesRootDir(baseDir: string = homedir()): string {
  return join(baseDir, ROOT_NAME, 'Themes')
}

export function findThemeDir(id: string, baseDir: string = homedir()): string | undefined {
  const root = themesRootDir(baseDir)
  if (!existsSync(root)) return undefined
  const match = readdirSync(root, { withFileTypes: true }).find(
    (entry) => entry.isDirectory() && entry.name.startsWith(`${id}-`)
  )
  return match ? join(root, match.name) : undefined
}

function themeDirOrThrow(id: string, baseDir: string): string {
  const dir = findThemeDir(id, baseDir)
  if (!dir) throw new Error(`No theme found with id ${id}`)
  return dir
}

export function readTheme(id: string, baseDir: string = homedir()): Theme {
  const dir = themeDirOrThrow(id, baseDir)
  return ThemeSchema.parse(JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf-8')))
}

/** Newest first. A folder that cannot be read is left out rather than taking the list down. */
export function listThemes(baseDir: string = homedir()): Theme[] {
  const root = themesRootDir(baseDir)
  if (!existsSync(root)) return []

  const themes: Theme[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      themes.push(ThemeSchema.parse(JSON.parse(readFileSync(join(root, entry.name, 'theme.json'), 'utf-8'))))
    } catch (err) {
      console.error(`Skipping the theme in ${entry.name}, which could not be read:`, err)
    }
  }
  return themes.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

export function createTheme(draft: ThemeDraft, baseDir: string = homedir()): Theme {
  const id = randomUUID()
  const dir = join(themesRootDir(baseDir), `${id}-${slugify(draft.name)}`)
  mkdirSync(join(dir, 'fonts'), { recursive: true })

  const theme = ThemeSchema.parse({
    ...ThemeDraftSchema.parse(draft),
    id,
    createdAt: new Date().toISOString(),
    schemaVersion: THEME_SCHEMA_VERSION
  })
  writeJsonAtomic(join(dir, 'theme.json'), theme)
  return theme
}

export function updateTheme(id: string, draft: ThemeDraft, baseDir: string = homedir()): Theme {
  const dir = themeDirOrThrow(id, baseDir)
  const current = readTheme(id, baseDir)
  const theme = ThemeSchema.parse({
    ...ThemeDraftSchema.parse(draft),
    id,
    createdAt: current.createdAt,
    schemaVersion: THEME_SCHEMA_VERSION
  })
  writeJsonAtomic(join(dir, 'theme.json'), theme)
  return theme
}

/** The caller is expected to have shown projectsUsingTheme first — there is no undo for this. */
export function deleteTheme(id: string, baseDir: string = homedir()): void {
  rmSync(themeDirOrThrow(id, baseDir), { recursive: true, force: true })
}

/**
 * Save a logo or a font into the theme's folder. Returns the path relative to it, which is what
 * the theme records.
 *
 * Checked by extension because both are handed to a browser to draw — a logo as an image, a font
 * as a face — and anything else has no business being there. A logo always takes the one name,
 * so replacing it cannot leave the old one behind to be picked up.
 */
export function writeThemeAsset(
  id: string,
  kind: 'logo' | 'font',
  fileName: string,
  bytes: Buffer,
  baseDir: string = homedir()
): string {
  const dir = themeDirOrThrow(id, baseDir)
  const extension = extname(fileName).toLowerCase()

  if (kind === 'logo') {
    if (!LOGO_TYPES.has(extension)) throw new Error('A logo has to be an SVG, PNG, JPEG or WebP image.')
    if (bytes.length > MAX_LOGO_BYTES) throw new Error('A logo has to be under 2 MB.')
    for (const old of readdirSync(dir).filter((name) => name.startsWith('logo.'))) rmSync(join(dir, old))
    const name = `logo${extension === '.jpeg' ? '.jpg' : extension}`
    writeFileSync(join(dir, name), bytes)
    return name
  }

  if (!FONT_TYPES.has(extension)) throw new Error('A font has to be a WOFF2, WOFF, TTF or OTF file.')
  mkdirSync(join(dir, 'fonts'), { recursive: true })
  const name = basename(fileName).replace(/[^\w.-]+/g, '-')
  writeFileSync(join(dir, 'fonts', name), bytes)
  return `fonts/${name}`
}

/** Which projects would be left without their theme if this one went. */
export function projectsUsingTheme(id: string, baseDir: string = homedir()): { id: string; name: string }[] {
  return listProjects(baseDir).flatMap((summary) => {
    try {
      const project = openProject(summary.id, baseDir)
      return project.themeId === id ? [{ id: project.id, name: project.name }] : []
    } catch {
      return []
    }
  })
}
