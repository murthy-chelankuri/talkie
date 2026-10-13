import { existsSync, mkdtempSync, copyFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join, sep } from 'path'

/**
 * The export page, wherever this build keeps it: out/export-page in a build (unpacked from the
 * archive, because a headless browser fetches it and only Node can read inside an asar), or
 * built from the sources on first use in a checkout — as the HTML scene runtime is
 * (htmlScene/resources.ts).
 */
export function shippedDir(fromDir: string = __dirname): string {
  return join(fromDir.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`), '..', 'export-page')
}

let built: string | null = null
function builtInCheckout(): string {
  if (built) return built
  // esbuild is a build tool: loaded only here, in a checkout, never by a packaged build.
  const { buildSync } = createRequire(__filename)('esbuild') as typeof import('esbuild')
  const out = mkdtempSync(join(tmpdir(), 'talkie-export-page-'))
  const root = join(__dirname, '..', '..', '..', '..')
  buildSync({
    entryPoints: [join(root, 'src/video/exportPage/page.tsx')],
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: join(out, 'page.js')
  })
  copyFileSync(join(root, 'src/video/exportPage/index.html'), join(out, 'index.html'))
  built = out
  return out
}

const TYPES = { 'index.html': 'text/html; charset=utf-8', 'page.js': 'text/javascript; charset=utf-8' } as const

export function exportPageResource(name: string): { path: string; type: string } | null {
  if (!(name in TYPES)) return null
  const shipped = shippedDir()
  const dir = existsSync(join(shipped, 'page.js')) ? shipped : builtInCheckout()
  return { path: join(dir, name), type: TYPES[name as keyof typeof TYPES] }
}
