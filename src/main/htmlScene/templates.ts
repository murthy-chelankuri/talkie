import { readFileSync, readdirSync } from 'fs'
import { extname, join, relative } from 'path'
import { templatesDir } from './resources'
import { TEXT_TYPES } from './store'

/** The starting points offered under "Add scene → HTML scene", named by their own pages. */
export function listTemplates(): { id: string; name: string; description: string }[] {
  return readdirSync(templatesDir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const page = readFileSync(join(templatesDir(), entry.name, 'index.html'), 'utf-8')
      const [name, description = ''] = (/<meta name="talkie:template" content="([^"]*)"/.exec(page)?.[1] ?? entry.name).split(' — ')
      return { id: entry.name, name, description }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function templateFiles(id: string): Record<string, string | Buffer> {
  if (!/^[\w-]+$/.test(id)) throw new Error(`There is no template called ${id}.`)
  const dir = join(templatesDir(), id)
  const walk = (at: string): string[] =>
    readdirSync(at, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(at, entry.name)) : [join(at, entry.name)]))
  return Object.fromEntries(
    walk(dir).map((path) => [relative(dir, path), TEXT_TYPES.has(extname(path).toLowerCase()) ? readFileSync(path, 'utf-8') : readFileSync(path)])
  )
}
