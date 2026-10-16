import { readFileSync, readdirSync } from 'fs'
import { extname, join, relative } from 'path'
import { templatesDir } from './resources'
import { TEXT_TYPES } from './store'

/** A starting point for an HTML scene. */
export type HtmlTemplate = {
  id: string
  name: string
  description: string
  /** Slides, Diagrams, Data, Motion, Code — how the gallery groups them. */
  category: string
  /**
   * The values the page reads, with what it shows by default: a scene made from it starts with
   * these, so the form has every field to change from the first moment. They were left out, and a
   * new scene said it had "no values to change" — changing a chart's title meant editing code.
   */
  values: Record<string, unknown>
}

/** The starting points offered when adding a scene, named by their own pages. */
export function listTemplates(): HtmlTemplate[] {
  return readdirSync(templatesDir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const page = readFileSync(join(templatesDir(), entry.name, 'index.html'), 'utf-8')
      const [name, description = ''] = (/<meta name="talkie:template" content="([^"]*)"/.exec(page)?.[1] ?? entry.name).split(' — ')
      const category = /<meta name="talkie:category" content="([^"]*)"/.exec(page)?.[1] ?? 'Other'
      return { id: entry.name, name, description, category, values: templateValues(page) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The values a template declares in its `talkie-values` block; none for a page that has none. */
export function templateValues(page: string): Record<string, unknown> {
  const block = /<script type="application\/json" id="talkie-values">([\s\S]*?)<\/script>/.exec(page)?.[1]
  if (!block) return {}
  try {
    const parsed = JSON.parse(block) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** A template's picture for the gallery, as a data URL; null for one that has none. */
export function templateThumbnail(id: string): string | null {
  if (!/^[\w-]+$/.test(id)) return null
  try {
    return `data:image/png;base64,${readFileSync(join(templatesDir(), id, THUMBNAIL)).toString('base64')}`
  } catch {
    return null
  }
}

/** The gallery's picture of a template — beside it, never part of a scene made from it. */
const THUMBNAIL = 'thumbnail.png'

export function templateFiles(id: string): Record<string, string | Buffer> {
  if (!/^[\w-]+$/.test(id)) throw new Error(`There is no template called ${id}.`)
  const dir = join(templatesDir(), id)
  const walk = (at: string): string[] =>
    readdirSync(at, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(at, entry.name)) : [join(at, entry.name)]))
  return Object.fromEntries(
    walk(dir)
      .filter((path) => relative(dir, path) !== THUMBNAIL)
      .map((path) => [relative(dir, path), TEXT_TYPES.has(extname(path).toLowerCase()) ? readFileSync(path, 'utf-8') : readFileSync(path)])
  )
}
