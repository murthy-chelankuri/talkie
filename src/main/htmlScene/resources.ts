import { buildSync } from 'esbuild'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { dirname, join, sep } from 'path'

/**
 * The runtime, the host page, the libraries and the templates, wherever this build keeps them.
 *
 * A build has them in out/html-scene, beside out/main and out/mcp, and unpacked from the archive
 * because the MCP server is plain node. A checkout running the tests has only the sources, so the
 * two scripts are built on first use and the libraries come from node_modules.
 */
export const LIBRARIES: Record<string, [pkg: string, file: string]> = {
  'lib/anime.min.js': ['animejs', 'lib/anime.min.js'],
  'lib/d3.min.js': ['d3', 'dist/d3.min.js'],
  'lib/lottie.min.js': ['lottie-web', 'build/player/lottie.min.js']
}

/**
 * A package's own folder, found from its main entry. Not `require.resolve('d3/dist/...')`: D3's
 * exports map only allows its entry points, and the browser build is not one of them.
 */
function packageDir(name: string): string {
  let dir = dirname(createRequire(__filename).resolve(name))
  while (dir !== dirname(dir)) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf-8')).name === name) return dir
    dir = dirname(dir)
  }
  throw new Error(`Could not find the ${name} package.`)
}
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html' }

export function shippedDir(fromDir: string = __dirname): string {
  return join(fromDir.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`), '..', 'html-scene')
}

let built: string | null = null
function builtInCheckout(): string {
  if (built) return built
  const out = mkdtempSync(join(tmpdir(), 'talkie-html-scene-'))
  const root = join(__dirname, '..', '..', '..')
  for (const [entry, file] of [['src/htmlScene/runtime/index.ts', 'runtime.js'], ['src/htmlScene/host/host.ts', 'host.js']]) {
    buildSync({ entryPoints: [join(root, entry)], bundle: true, format: 'iife', target: 'chrome120', outfile: join(out, file) })
  }
  built = out
  return out
}

export function htmlSceneResource(name: string): { path: string; type: string } | null {
  const shipped = shippedDir()
  const fromShipped = existsSync(join(shipped, 'runtime.js'))
  const type = TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream'
  if (name === 'runtime.js' || name === 'host.js') {
    return { path: join(fromShipped ? shipped : builtInCheckout(), name), type }
  }
  if (name === 'host.html') {
    return { path: fromShipped ? join(shipped, name) : join(__dirname, '..', '..', 'htmlScene', 'host', 'host.html'), type }
  }
  if (name in LIBRARIES) {
    return { path: fromShipped ? join(shipped, name) : join(packageDir(LIBRARIES[name][0]), LIBRARIES[name][1]), type }
  }
  return null
}

export function templatesDir(): string {
  const shipped = join(shippedDir(), 'templates')
  return existsSync(shipped) ? shipped : join(__dirname, '..', '..', '..', 'resources', 'html-templates')
}
