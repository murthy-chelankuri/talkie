import { existsSync } from 'fs'
import { join, sep } from 'path'
import { bundle } from '@remotion/bundler'

/**
 * Where the composition to render is.
 *
 * Export used to bundle it on demand from `join(process.cwd(), 'src/remotion/index.tsx')`, and
 * both halves of that are wrong once the app is packaged. `process.cwd()` is wherever the app
 * was launched from, which is `/` from Finder; and `src` is not shipped at all, because
 * electron-builder ships `out/**` and nothing else. Export therefore worked in a checkout and
 * failed in every installed build, on the first press of the button — the same shape of bug as
 * the binaries one, and for the same reason: a path that only resolves in a checkout.
 *
 * So the bundle is built at build time by scripts/bundleRemotion.mjs and shipped beside the
 * compiled main process, where `__dirname` finds it whatever the working directory is. Building
 * from source stays the fallback, because in a checkout it is what makes a change to the
 * composition show up in an export without a rebuild first.
 */

/**
 * Built by scripts/bundleRemotion.mjs into out/remotion, next to out/main.
 *
 * Rewritten out of the archive when it is in one. `__dirname` in a packaged build is inside
 * `app.asar`, and Electron's own `fs` quietly redirects reads from there to `app.asar.unpacked`
 * — which is enough to make the directory look present and not enough to render from, because
 * the bundle is fetched by a headless browser rather than read by Node. Pointing at the unpacked
 * copy directly is what `binaries.ts` does with the compositor, and for the same reason.
 */
export function shippedBundleDir(fromDir: string = __dirname): string {
  return join(fromDir.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`), '..', 'remotion')
}

/**
 * Whether a bundle was shipped with this build.
 *
 * Checked by its entry file rather than the directory, because an empty or half-written
 * directory would pass and then fail at render time, which is the worst moment to find out.
 */
export function hasShippedBundle(fromDir: string = __dirname): boolean {
  return existsSync(join(shippedBundleDir(fromDir), 'index.html'))
}

export async function remotionBundleLocation(
  sourceEntry: string,
  fromDir: string = __dirname
): Promise<string> {
  if (hasShippedBundle(fromDir)) return shippedBundleDir(fromDir)
  return bundle({ entryPoint: sourceEntry })
}
