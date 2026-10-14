/**
 * Builds the export page — the composition on Talkie's own clock — into out/export-page, beside
 * out/main and out/mcp. Served by the asset server and resolved from __dirname: see
 * src/main/render/exporter/exportPage.ts.
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'out/export-page')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
await build({
  entryPoints: [join(root, 'src/video/exportPage/page.tsx')],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: join(out, 'page.js')
})
cpSync(join(root, 'src/video/exportPage/index.html'), join(out, 'index.html'))
console.log(`Export page built into ${out}`)
