import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'

/**
 * `@napi-rs/canvas` is native and not one of the app's own dependencies — pdfjs brings it — so the
 * main-process build bundles anything that imports it statically, and the bundled copy throws as
 * the app loads ("Cannot use 'in' operator to search for 'families'"). The tests run the sources
 * and never see it; only `npm run dev` or a packaged app does. Load it with `await import()`, only
 * where it is needed, as rasterisePdf.ts does.
 */
const ROOT = join(__dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : []
  )
}

describe('the main process', () => {
  it('never imports the native canvas statically', () => {
    const offenders = sources(join(ROOT, 'main')).filter((file) => /^\s*import\b[^;]*from\s+['"]@napi-rs\/canvas['"]/m.test(readFileSync(file, 'utf-8')))

    expect(offenders.map((file) => relative(ROOT, file))).toEqual([])
  })
})
