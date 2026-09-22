/**
 * Builds the Remotion composition into something a packaged app can render from.
 *
 * Export used to bundle the composition on demand, from `src/remotion/index.tsx` resolved
 * through `process.cwd()`. Both halves of that are wrong once the app is packaged: `cwd` is
 * wherever the app was launched from — `/` from Finder — and `src` is not shipped at all, since
 * electron-builder ships `out/**` and nothing else. So export worked in a checkout and failed
 * in every installed build, on the first press of the button.
 *
 * Bundling here instead means the webpack build happens once, at build time, on a machine that
 * has the sources and the toolchain. What ships is the finished bundle, which `renderMedia`
 * takes as a `serveUrl` directly.
 *
 *   node scripts/bundleRemotion.mjs
 */
import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(root, 'src/remotion/index.tsx')
const OUT = join(root, 'out/remotion')

// Built fresh: a stale bundle is worse than none, because it renders successfully and shows the
// composition as it was two changes ago.
rmSync(OUT, { recursive: true, force: true })

const location = await bundle({
  entryPoint: ENTRY,
  outDir: OUT,
  // Nothing here is served from a domain, so the bundle is addressed by relative path.
  publicPath: './',
  onProgress: (percent) => {
    if (percent === 100) console.log('Bundled the composition for rendering')
  }
})

console.log(`Remotion bundle: ${location}`)
