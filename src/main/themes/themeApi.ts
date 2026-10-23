import { randomUUID } from 'crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, extname, join, normalize, sep } from 'path'
import { readFontInfo, type FontInfo } from './fontInfo'
import { writeJsonAtomic } from '../project/atomicWrite'
import { slugify } from '../project/slug'
import { ROOT_NAME } from '../project/migrateStorageRoot'
import { studioDir } from '../studio/studio'
import { listProjects, openProject } from '../project/projectApi'
import { BUILTIN_THEMES, builtinTheme, isBuiltinThemeId } from './builtinThemes'
import { THEME_SCHEMA_VERSION, ThemeDraftSchema, ThemeSchema, migrateTheme, type Theme, type ThemeDraft } from './schema'

/**
 * The theme library: one folder per theme, beside the projects.
 *
 * A library rather than a copy inside each project, so the second video for a company looks like
 * the first without anyone re-making anything — and correcting a colour corrects it everywhere.
 */

/** Carried into every frame as a data URL; much more than this and the render slows to a crawl. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024

/**
 * A background rides into every frame it is on as a data URL too. The ceiling is higher than a
 * logo's because imagery needs the detail, and the file is kept verbatim — never downscaled, so
 * no quality is lost — but past this it is left off the render and the brand check says so, rather
 * than silently dragging the export.
 */
export const MAX_BACKGROUND_BYTES = 12 * 1024 * 1024

const IMAGE_TYPES = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])
const FONT_TYPES = new Set(['.woff2', '.woff', '.ttf', '.otf'])

export function themesRootDir(baseDir: string = homedir()): string {
  const current = join(studioDir(baseDir), 'Themes')
  // Where they were before the Studio, should the move at startup not have happened.
  const before = join(baseDir, ROOT_NAME, 'Themes')
  return !existsSync(current) && existsSync(before) ? before : current
}

/** Never for a built-in theme, which has no folder — and so nowhere a file could be written. */
export function findThemeDir(id: string, baseDir: string = homedir()): string | undefined {
  if (isBuiltinThemeId(id)) return undefined
  const root = themesRootDir(baseDir)
  if (!existsSync(root)) return undefined
  const match = readdirSync(root, { withFileTypes: true }).find(
    (entry) => entry.isDirectory() && entry.name.startsWith(`${id}-`)
  )
  return match ? join(root, match.name) : undefined
}

function themeDirOrThrow(id: string, baseDir: string): string {
  if (isBuiltinThemeId(id)) throw new Error('Built-in themes cannot be changed or deleted. Duplicate it to make your own.')
  const dir = findThemeDir(id, baseDir)
  if (!dir) throw new Error(`No theme found with id ${id}`)
  return dir
}

export function readTheme(id: string, baseDir: string = homedir()): Theme {
  const builtIn = builtinTheme(id)
  if (builtIn) return builtIn
  const dir = themeDirOrThrow(id, baseDir)
  return ThemeSchema.parse(migrateTheme(JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf-8'))))
}

/**
 * The person's own, newest first, then the built-in ones. A folder that cannot be read is left out
 * rather than taking the list down.
 */
export function listThemes(baseDir: string = homedir()): Theme[] {
  const root = themesRootDir(baseDir)
  if (!existsSync(root)) return [...BUILTIN_THEMES]

  const themes: Theme[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    // Dot-folders hold drafts not yet saved — see generateTheme.ts.
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    try {
      themes.push(ThemeSchema.parse(migrateTheme(JSON.parse(readFileSync(join(root, entry.name, 'theme.json'), 'utf-8')))))
    } catch (err) {
      console.error(`Skipping the theme in ${entry.name}, which could not be read:`, err)
    }
  }
  themes.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  return [...themes, ...BUILTIN_THEMES]
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

/**
 * A copy to change: how a built-in theme is made someone's own, and how one company's theme starts
 * another's. Its logo and fonts come with it, since the theme records them by path inside its folder.
 */
export function duplicateTheme(id: string, baseDir: string = homedir()): Theme {
  const source = readTheme(id, baseDir)
  const copy = createTheme({ ...source, name: `${source.name} copy` }, baseDir)
  const from = isBuiltinThemeId(id) ? undefined : findThemeDir(id, baseDir)
  const to = findThemeDir(copy.id, baseDir)
  if (from && to) {
    for (const entry of readdirSync(from)) {
      if (entry !== 'theme.json') cpSync(join(from, entry), join(to, entry), { recursive: true })
    }
  }
  return copy
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
  kind: 'logo' | 'background' | 'font',
  slot: string,
  fileName: string,
  bytes: Buffer,
  baseDir: string = homedir()
): string {
  return writeAssetInto(themeDirOrThrow(id, baseDir), kind, slot, fileName, bytes)
}

/**
 * The same, into any folder — a saved theme's, or a draft's that has not been saved yet.
 *
 * A logo or a background goes into its own subfolder, named for the slot it fills (`logos/light.svg`,
 * `backgrounds/card-dark.jpg`), so one file to a slot and replacing it cannot leave the old one
 * behind to be picked up. A font keeps its own name under `fonts/`, since a family is several files.
 * Everything is written exactly as it arrived.
 */
export function writeAssetInto(
  dir: string,
  kind: 'logo' | 'background' | 'font',
  slot: string,
  fileName: string,
  bytes: Buffer
): string {
  mkdirSync(dir, { recursive: true })
  const extension = extname(fileName).toLowerCase()
  const ext = extension === '.jpeg' ? '.jpg' : extension

  if (kind === 'logo' || kind === 'background') {
    if (!IMAGE_TYPES.has(extension)) throw new Error('A logo or background has to be an SVG, PNG, JPEG or WebP image.')
    const ceiling = kind === 'logo' ? MAX_LOGO_BYTES : MAX_BACKGROUND_BYTES
    if (bytes.length > ceiling) throw new Error(kind === 'logo' ? 'A logo has to be under 2 MB.' : 'A background has to be under 12 MB.')
    const subdir = kind === 'logo' ? 'logos' : 'backgrounds'
    const into = join(dir, subdir)
    mkdirSync(into, { recursive: true })
    for (const old of readdirSync(into).filter((name) => name.startsWith(`${slot}.`))) rmSync(join(into, old))
    const name = `${slot}${ext}`
    writeFileSync(join(into, name), bytes)
    return `${subdir}/${name}`
  }

  if (!FONT_TYPES.has(extension)) throw new Error('A font has to be a WOFF2, WOFF, TTF or OTF file.')
  mkdirSync(join(dir, 'fonts'), { recursive: true })
  const name = basename(fileName).replace(/[^\w.-]+/g, '-')
  writeFileSync(join(dir, 'fonts', name), bytes)
  return `fonts/${name}`
}

/** A font file kept in a theme, and what it says it is. */
export type ThemeFontFile = { file: string } & FontInfo

/**
 * Save a font of the person's own into a theme, read first: a file that is not a font Talkie can
 * read would only fail later, as a video drawn in the wrong typeface with nothing said why.
 */
export function addFontInto(dir: string, fileName: string, bytes: Buffer): ThemeFontFile {
  const info = readFontInfo(bytes)
  if (!info) throw new Error(`${basename(fileName)} is not a font Talkie can read. Use the .otf, .ttf, .woff or .woff2 files the company's font came in.`)
  return { file: writeAssetInto(dir, 'font', '', fileName, bytes), ...info }
}

/** What each of a theme's font files is, for listing them; a file gone or unreadable is left out. */
export function describeFontFiles(dir: string, files: string[]): ThemeFontFile[] {
  return files.flatMap((file) => {
    const path = join(dir, normalize(file))
    if (!path.startsWith(dir + sep) || !existsSync(path)) return []
    const info = readFontInfo(readFileSync(path))
    return info ? [{ file, ...info }] : []
  })
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
