import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { browserExecutablePath } from '../capture/resolveBrowser'

/**
 * Exporting from an app that was not started in its own directory.
 *
 * A packaged app opened from Finder runs with `/` as its working directory. Remotion works out
 * where to keep the browser it renders with by walking up from there looking for a package.json,
 * finds none, and settles on `/.remotion` — which cannot be created. Export died with
 * `ENOENT: mkdir '/.remotion'`, a message that names nothing a user could act on.
 *
 * The suite never saw it because vitest runs from the checkout, where the walk finds this
 * project's own package.json one level up and everything resolves. So the working directory is
 * moved here on purpose: it is the only thing that differs between the two, and testing it any
 * other way tests the case that always worked.
 */
describe('exporting with the working directory somewhere unwritable', () => {
  const wasIn = process.cwd()
  afterEach(() => process.chdir(wasIn))

  it('finds a browser to render with without looking beside the working directory', () => {
    process.chdir('/')

    const browser = browserExecutablePath()

    expect(browser, 'no Chromium-based browser on this machine').not.toBeNull()
    expect(existsSync(browser!)).toBe(true)
    // Absolute, because a relative one would be resolved against the very directory that is wrong.
    expect(browser!.startsWith('/')).toBe(true)
  })

  it('hands that browser to both of Remotion\'s calls that would otherwise fetch one', () => {
    // Remotion only skips working out a download directory when it is given a browser outright.
    // Miss either call and export fails in a packaged build and nowhere else.
    const source = readFileSync(join(__dirname, 'remotionExport.ts'), 'utf-8')

    for (const call of ['selectComposition(', 'renderMedia(']) {
      const at = source.indexOf(call)
      expect(at, `${call} is no longer called here — update this test`).toBeGreaterThan(-1)
      expect(source.slice(at, at + 400), `${call} is missing browserExecutable`).toContain('browserExecutable')
    }
  })

  it("launches Talkie's own exporter with that browser too", () => {
    const source = readFileSync(join(__dirname, 'exporter/exportVideo.ts'), 'utf-8')

    expect(source).toContain('executablePath: browserExecutablePath()')
  })
})
