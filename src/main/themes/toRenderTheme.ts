import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { extname, join, normalize, sep } from 'path'
import { findThemeDir, readTheme } from './themeApi'
import { BUILTIN_FONTS, type FontChoice, type ThemeDraft } from './schema'
import { themeStamp, type RenderTheme } from '../../remotion/renderTheme'

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

function dataUrl(bytes: Buffer, file: string): string {
  return `data:${MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`
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

  const logoBytes = draft.logo && dir ? readInside(dir, draft.logo.file) : null

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
    ...(draft.logo && logoBytes
      ? { logo: { url: dataUrl(logoBytes, draft.logo.file), corner: draft.logo.corner, showOn: draft.logo.showOn } }
      : {}),
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
