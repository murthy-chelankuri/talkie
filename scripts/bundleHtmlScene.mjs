/**
 * Builds what HTML scenes are served besides their own files into out/html-scene: the runtime and
 * the headless host (esbuild, one file each), the three libraries Talkie offers scenes, and the
 * templates. Resolved at run time from __dirname — see src/main/htmlScene/resources.ts.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'out/html-scene')
const require = createRequire(import.meta.url)
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'lib'), { recursive: true })

for (const [entry, file] of [['src/htmlScene/runtime/index.ts', 'runtime.js'], ['src/htmlScene/host/host.ts', 'host.js']]) {
  await build({ entryPoints: [join(root, entry)], bundle: true, format: 'iife', target: 'chrome120', minify: true, outfile: join(out, file) })
}
cpSync(join(root, 'src/htmlScene/host/host.html'), join(out, 'host.html'))
// From each package's own folder: D3's exports map does not allow its browser build to be resolved.
const packageDir = (name) => {
  let dir = dirname(require.resolve(name))
  while (!existsSync(join(dir, 'package.json')) || JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).name !== name) dir = dirname(dir)
  return dir
}
cpSync(join(packageDir('animejs'), 'lib/anime.min.js'), join(out, 'lib/anime.min.js'))
cpSync(join(packageDir('d3'), 'dist/d3.min.js'), join(out, 'lib/d3.min.js'))
cpSync(join(packageDir('lottie-web'), 'build/player/lottie.min.js'), join(out, 'lib/lottie.min.js'))
cpSync(join(root, 'resources/html-templates'), join(out, 'templates'), { recursive: true })
console.log(`HTML scene resources built into ${out}`)
