import { existsSync, readFileSync } from 'fs'
import { readFontInfo } from './fontInfo'
import { homedir } from 'os'
import { basename, extname, join, normalize, sep } from 'path'
import { findThemeDir, readTheme, MAX_BACKGROUND_BYTES } from './themeApi'
import { BUILTIN_FONTS, type BackgroundFit, type FontChoice, type ThemeDraft, type VariantId } from './schema'
import { themeStamp, type RenderTheme } from '../../composition/renderTheme'
import { stillLogo } from './stillLogo'

/**
 * A theme as the video needs it: colours as they are, and its logo and fonts read off disk into
 * data URLs. Used for the preview and the export alike, so the two cannot disagree.
 */

/** Fonts ride along in every render's props; past this the render itself starts to drag. */
export const MAX_FONT_BYTES = 3 * 1024 * 1024

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
}

/** A file inside the theme's folder, or nothing — a path recorded in theme.json is not trusted to stay in it. */
function readInside(dir: string, relative: string): Buffer | null {
  const path = normalize(join(dir, relative))
  if (!path.startsWith(dir + sep) || !existsSync(path)) return null
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

/**
 * A file as a data URL. A font also carries which face it is — its weight and whether it slants —
 * because a family arrives as several files and each has to be declared as the one it is.
 *
 * Read from inside the file (fontInfo.ts). It was read off the file's name ("Inter-600"), which
 * suits the open fonts Talkie downloads and nothing else: a company's `AcmeSans-Bold.otf` named no
 * number, so it was declared as every weight, and its regular and bold fought over all the text.
 */
function dataUrl(bytes: Buffer, file: string): string {
  const extension = extname(file).toLowerCase()
  const type = MIME[extension] ?? 'application/octet-stream'
  let face = ''
  if (type.startsWith('font/')) {
    const info = readFontInfo(bytes)
    face = `;name=${basename(file, extname(file)).replace(/[^\w-]/g, '')}`
    if (info) face += `;weight=${info.variable ? '100-900' : info.weight};style=${info.italic ? 'italic' : 'normal'}`
  }
  return `data:${type}${face};base64,${bytes.toString('base64')}`
}

/** A theme that has not been saved yet — the editor's draft — renders from wherever its files are. */
export function renderThemeFrom(draft: ThemeDraft, dir: string | undefined): RenderTheme {
  let budget = MAX_FONT_BYTES

  const font = (choice: FontChoice, fallback: string): { family: string; urls: string[] } => {
    if (choice.source === 'builtin' || choice.files.length === 0 || !dir) return { family: choice.family, urls: [] }
    const files = choice.files.map((file) => ({ file, bytes: readInside(dir, file) }))
    const size = files.reduce((sum, { bytes }) => sum + (bytes?.length ?? 0), 0)
    // A missing file or a family too large to carry falls back to Talkie's own, which every
    // render has — a theme must never be the reason a video fails to draw.
    if (files.some(({ bytes }) => !bytes) || size > budget) return { family: fallback, urls: [] }
    budget -= size
    return { family: choice.family, urls: files.map(({ file, bytes }) => dataUrl(bytes as Buffer, file)) }
  }

  const warnings: string[] = []

  // One logo slot as a data URL. Settled here rather than when saved, so logos already in the
  // library are fixed too, and the file itself stays exactly as the brand published it.
  const logoSlot = (file: string | undefined): string | undefined => {
    if (!file || !dir) return undefined
    const stored = readInside(dir, file)
    if (!stored) return undefined
    const bytes = extname(file).toLowerCase() === '.svg' ? Buffer.from(stillLogo(stored.toString('utf-8'))) : stored
    return dataUrl(bytes, file)
  }

  const light = logoSlot(draft.logo?.light?.file)
  const dark = logoSlot(draft.logo?.dark?.file)
  const logo =
    draft.logo && (light || dark)
      ? {
          ...(light ? { light } : {}),
          ...(dark ? { dark } : {}),
          corner: draft.logo.corner,
          showOn: draft.logo.showOn,
          ...(draft.logo.clearSpace !== undefined ? { clearSpace: draft.logo.clearSpace } : {}),
          ...(draft.logo.minHeight !== undefined ? { minHeight: draft.logo.minHeight } : {})
        }
      : undefined

  const background = (
    entry: { file: string; fit: BackgroundFit; scrim: number } | undefined,
    label: string
  ): { url: string; fit: BackgroundFit; scrim: number } | undefined => {
    if (!entry || !dir) return undefined
    const bytes = readInside(dir, entry.file)
    if (!bytes) return undefined
    // Left off rather than shrunk: the file keeps its quality on disk, and the brand check says why.
    if (bytes.length > MAX_BACKGROUND_BYTES) {
      warnings.push(`The ${label} background (${entry.file}) is too large to show — over 12 MB — so it was left off. Save a smaller file.`)
      return undefined
    }
    return { url: dataUrl(bytes, entry.file), fit: entry.fit, scrim: entry.scrim }
  }

  const backgroundsFor = (ctx: 'card' | 'content'): Partial<Record<VariantId, { url: string; fit: BackgroundFit; scrim: number }>> | undefined => {
    const group = draft.backgrounds?.[ctx]
    if (!group) return undefined
    const out: Partial<Record<VariantId, { url: string; fit: BackgroundFit; scrim: number }>> = {}
    for (const v of ['brand', 'light', 'dark'] as const) {
      const built = background(group[v], `${ctx} ${v}`)
      if (built) out[v] = built
    }
    return Object.keys(out).length ? out : undefined
  }

  const card = dir ? backgroundsFor('card') : undefined
  const content = dir ? backgroundsFor('content') : undefined
  const backgrounds = card || content ? { ...(card ? { card } : {}), ...(content ? { content } : {}) } : undefined

  return {
    stamp: themeStamp(draft),
    company: draft.company,
    tagline: draft.tagline,
    website: draft.website,
    variants: draft.variants,
    fonts: {
      heading: font(draft.fonts.heading, BUILTIN_FONTS.serif),
      body: font(draft.fonts.body, BUILTIN_FONTS.sans)
    },
    ...(logo ? { logo } : {}),
    ...(backgrounds ? { backgrounds } : {}),
    ...(draft.brand ? { brand: draft.brand } : {}),
    ...(draft.locks ? { locks: draft.locks } : {}),
    ...(warnings.length ? { warnings } : {}),
    caption: draft.overlays.caption
  }
}

/** The project's theme, ready to draw — or null for a project without one, or a theme deleted from under it. */
export function toRenderTheme(themeId: string | undefined, baseDir: string = homedir()): RenderTheme | null {
  if (!themeId) return null
  try {
    return renderThemeFrom(readTheme(themeId, baseDir), findThemeDir(themeId, baseDir))
  } catch {
    return null
  }
}
