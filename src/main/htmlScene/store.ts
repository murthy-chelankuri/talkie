import { randomUUID } from 'crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, extname, join, normalize, relative, sep } from 'path'
import { findProjectDir } from '../project/paths'
import { readTimelineLenient } from '../project/projectApi'

/**
 * An HTML scene's files, one folder per revision.
 *
 * A folder is never changed once written: a save writes a new one and the clip points at it. Undo
 * restores the timeline, and so the pointer, and the old folder is still there to point at —
 * history stays two JSON files. Folders nothing points at are swept when the project opens, which
 * is the one moment no undo can reach them.
 */
export const SCENE_FILE_TYPES = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.woff2', '.woff', '.ttf', '.otf', '.txt'])
export const TEXT_TYPES = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt'])
export const MAX_SCENE_BYTES = 50 * 1024 * 1024
export const MAX_SCENE_FILES = 500

function scenesRoot(projectId: string, baseDir: string): string {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) throw new Error(`No project found with id ${projectId}`)
  return join(dir, 'sources', 'html')
}

export function sceneDirOf(entryPath: string): string {
  return dirname(entryPath)
}

/** A relative path inside the folder, or a refusal that says why. */
function checkedPath(path: string): string {
  const clean = normalize(path).replace(/^[/\\]+/, '')
  if (clean.startsWith('..') || clean.includes(`${sep}..${sep}`)) throw new Error(`"${path}" is outside the scene's folder.`)
  const type = extname(clean).toLowerCase()
  if (!SCENE_FILE_TYPES.has(type)) throw new Error(`A scene cannot hold ${type || 'files without a type'} ("${path}").`)
  return clean
}

function listFiles(dir: string, under = ''): string[] {
  return readdirSync(join(dir, under), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(dir, join(under, entry.name)) : [join(under, entry.name)]
  )
}

export function writeRevision(
  projectId: string,
  files: Record<string, string | Buffer>,
  opts: { from?: string; remove?: string[]; baseDir?: string } = {}
): string {
  const baseDir = opts.baseDir ?? homedir()
  const dir = join(scenesRoot(projectId, baseDir), randomUUID())
  mkdirSync(dir, { recursive: true })
  try {
    const removed = new Set((opts.remove ?? []).map(checkedPath))
    let entry: string | undefined
    if (opts.from) {
      const previous = sceneDirOf(opts.from)
      entry = relative(previous, opts.from)
      for (const file of listFiles(previous)) {
        if (removed.has(file) || file === 'poster.png' || file in files) continue
        mkdirSync(dirname(join(dir, file)), { recursive: true })
        cpSync(join(previous, file), join(dir, file))
      }
    }
    for (const [path, contents] of Object.entries(files)) {
      const clean = checkedPath(path)
      mkdirSync(dirname(join(dir, clean)), { recursive: true })
      writeFileSync(join(dir, clean), contents)
    }

    const written = listFiles(dir)
    if (written.length > MAX_SCENE_FILES) throw new Error(`A scene can hold at most ${MAX_SCENE_FILES} files.`)
    const bytes = written.reduce((sum, file) => sum + statSync(join(dir, file)).size, 0)
    if (bytes > MAX_SCENE_BYTES) throw new Error('A scene can hold at most 50 MB.')

    const pages = written.filter((file) => extname(file).toLowerCase() === '.html')
    entry = entry && written.includes(entry) ? entry : pages.includes('index.html') ? 'index.html' : pages.length === 1 ? pages[0] : undefined
    if (!entry) throw new Error('A scene needs an index.html to start from.')
    return join(dir, entry)
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

export function readRevision(entryPath: string): { path: string; text?: string; bytes: number }[] {
  const dir = sceneDirOf(entryPath)
  return listFiles(dir)
    .filter((file) => file !== 'poster.png')
    .sort()
    .map((file) => {
      const full = join(dir, file)
      const bytes = statSync(full).size
      return TEXT_TYPES.has(extname(file).toLowerCase()) ? { path: file, text: readFileSync(full, 'utf-8'), bytes } : { path: file, bytes }
    })
}

export function sweepUnusedRevisions(projectId: string, baseDir: string = homedir()): number {
  const root = scenesRoot(projectId, baseDir)
  if (!existsSync(root)) return 0
  const used = new Set(
    readTimelineLenient(projectId, baseDir)
      .filter((item) => item.kind === 'html')
      .map((item) => sceneDirOf((item.data as { src: string }).src))
  )
  let swept = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !used.has(join(root, entry.name))) {
      rmSync(join(root, entry.name), { recursive: true, force: true })
      swept++
    }
  }
  return swept
}
