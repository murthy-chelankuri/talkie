import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { hasShippedBundle, shippedBundleDir } from './remotionBundle'

/**
 * Finding the composition without asking where the app was launched from.
 *
 * Export resolved its entry point through `process.cwd()`, which is the directory the app
 * happened to be started in — `/` for one opened from Finder — and pointed it at `src`, which a
 * packaged build does not ship. So it worked in a checkout and failed in every installed build.
 * The same shape as the binaries bug beside it: a path that only resolves in a checkout, in code
 * the suite only ever ran from one.
 */
describe('where a packaged build finds the composition', () => {
  it('looks beside the compiled main process, not in the working directory', () => {
    // __dirname is the one thing that means the same in both builds. A test that called the
    // resolver from the repo would pass whatever it did, so the directory is passed in.
    expect(shippedBundleDir('/Applications/Talkie.app/Contents/Resources/app/out/main')).toBe(
      '/Applications/Talkie.app/Contents/Resources/app/out/remotion'
    )
  })

  it('points out of the archive, because a browser fetches these files rather than Node', () => {
    // Electron's fs redirects reads from app.asar to app.asar.unpacked, so this would look
    // present and still be unrenderable: the headless browser doing the fetching has no such
    // redirect. The same rewrite binaries.ts makes for the compositor.
    expect(shippedBundleDir('/Applications/Talkie.app/Contents/Resources/app.asar/out/main')).toBe(
      '/Applications/Talkie.app/Contents/Resources/app.asar.unpacked/out/remotion'
    )
  })

  it('does not accept a directory that exists but holds no bundle', () => {
    // Half a bundle passes a directory check and then fails at render time, which is the worst
    // moment to discover it — the user has already waited for the export.
    const dir = mkdtempSync(join(tmpdir(), 'talkie-bundle-'))
    mkdirSync(join(dir, 'remotion'), { recursive: true })
    const main = join(dir, 'main')
    mkdirSync(main, { recursive: true })

    expect(hasShippedBundle(main)).toBe(false)

    writeFileSync(join(dir, 'remotion', 'index.html'), '<!doctype html>')
    expect(hasShippedBundle(main)).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  it('is built by the build, so a package cannot ship without one', () => {
    // The bundle is only there if something makes it. Left out of `npm run build`, every dmg
    // would fall back to building from source at runtime — which is the bug this replaced.
    const scripts = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf-8')).scripts

    expect(scripts.build).toContain('build:remotion')
    expect(scripts['build:remotion']).toContain('bundleRemotion')
  })

  it('is unpacked from the archive, because it is served to a headless page', () => {
    // Same reason mermaid is unpacked: the renderer fetches these files, and nothing can be
    // read out of an asar archive by anything but Node.
    const builder = readFileSync(join(__dirname, '../../../electron-builder.yml'), 'utf-8')
    const asarUnpack = builder.slice(builder.indexOf('asarUnpack:'), builder.indexOf('\nmac:'))

    expect(asarUnpack).toContain('out/remotion/**')
  })

  it('never reaches for the working directory to find it', () => {
    // The whole bug in one line, and the only check that would have caught it. Comments are
    // stripped first, because the line explaining why cwd is wrong is not the line using it.
    const code = readFileSync(join(__dirname, 'renderProject.ts'), 'utf-8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n')

    expect(code).not.toContain('process.cwd()')
  })
})
