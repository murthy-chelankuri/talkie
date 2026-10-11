import { readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, extname, join, relative } from 'path'
import { rewriteBundledCdns } from './cdn'
import { MAX_SCENE_BYTES, MAX_SCENE_FILES, SCENE_FILE_TYPES, writeRevision } from './store'

export const LIBRARY_TOKEN = '__TALKIE_LIB__/'

/** A page or a folder, copied in as a scene. What a scene cannot hold is left behind and named. */
export function importScene(projectId: string, sourcePath: string, baseDir: string = homedir()): { src: string; warnings: string[] } {
  const warnings: string[] = []
  const files: Record<string, string | Buffer> = {}
  const isFolder = statSync(sourcePath).isDirectory()
  const paths = isFolder ? walk(sourcePath) : [sourcePath]
  if (paths.length > MAX_SCENE_FILES * 2) throw new Error(`That folder has ${paths.length} files; a scene can hold ${MAX_SCENE_FILES}.`)

  let total = 0
  for (const path of paths) {
    const name = isFolder ? relative(sourcePath, path) : basename(path)
    if (!SCENE_FILE_TYPES.has(extname(name).toLowerCase())) {
      warnings.push(`Left out ${name}: a scene cannot hold ${extname(name) || 'that kind of file'}.`)
      continue
    }
    total += statSync(path).size
    if (total > MAX_SCENE_BYTES) throw new Error('That is more than the 50 MB a scene can hold.')
    if (extname(name).toLowerCase() === '.html') {
      const { html, remote } = rewriteBundledCdns(readFileSync(path, 'utf-8'), LIBRARY_TOKEN)
      for (const url of remote) warnings.push(`${name} loads ${url} from the internet, which a scene cannot do.`)
      files[name] = html
    } else {
      files[name] = readFileSync(path)
    }
  }
  if (!isFolder && extname(sourcePath).toLowerCase() !== '.html') throw new Error('Import an .html page, or a folder with one in it.')
  // A single page keeps working under the name a scene starts from.
  if (!isFolder) {
    const [only] = Object.keys(files)
    files['index.html'] = files[only]
    if (only !== 'index.html') delete files[only]
  }
  return { src: writeRevision(projectId, files, { baseDir }), warnings }
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.name.startsWith('.') ? [] : entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )
}
