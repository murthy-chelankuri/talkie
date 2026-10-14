import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { browserExecutablePath } from '../capture/resolveBrowser'

/**
 * Exporting from an app that was not started in its own directory.
 *
 * A packaged app opened from Finder runs with `/` as its working directory. Anything that works
 * out where a browser lives by walking up from there finds nothing — the renderer Talkie used to
 * export with tried to create a folder at the root and export died with an `ENOENT` from `mkdir`, a
 * message that names nothing a user could act on. So the export is handed a browser outright.
 *
 * The suite never saw it because vitest runs from the checkout, where every such walk finds this
 * project's own package.json and resolves. So the working directory is moved here on purpose: it
 * is the only thing that differs between the two, and testing it any other way tests the case that
 * always worked.
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

  it('launches the exporter with that browser', () => {
    const source = readFileSync(join(__dirname, 'exporter/exportVideo.ts'), 'utf-8')

    expect(source).toContain('executablePath: browserExecutablePath()')
  })
})
