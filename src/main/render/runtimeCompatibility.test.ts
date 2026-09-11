import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Guards against a class of bug that unit tests cannot see.
 *
 * Slide import rasterises PDFs in the renderer, which is Electron's Chromium — an older engine
 * than the Node these tests run under. pdfjs 6 calls `Uint8Array.prototype.toHex`, which Node
 * has and that Chromium does not, so importing a deck failed at runtime with "n.toHex is not a
 * function" while every test passed. Raising either version means checking the other.
 */
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf-8')
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

function majorOf(range: string): number {
  return Number(range.replace(/^[^\d]*/, '').split('.')[0])
}

describe('renderer runtime compatibility', () => {
  it('keeps pdfjs on a line the bundled Chromium can actually run', () => {
    const pdfjs = packageJson.dependencies?.['pdfjs-dist']
    expect(pdfjs, 'pdfjs-dist is no longer a dependency').toBeTruthy()

    // 5.x and 6.x both reach for JS newer than Electron 32 ships.
    expect(
      majorOf(pdfjs as string),
      'pdfjs was raised past 4.x — check it still runs in Electron\'s Chromium before allowing this'
    ).toBeLessThanOrEqual(4)
  })

  it('notices if Electron is raised, since that is what pins pdfjs', () => {
    const electron = packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron
    expect(electron).toBeTruthy()

    // If this fails, Electron moved: re-check whether pdfjs can be raised with it.
    expect(majorOf(electron as string)).toBe(32)
  })

  it('has not quietly picked up a second pdf library to drift out of step with', () => {
    const all = { ...packageJson.dependencies, ...packageJson.devDependencies }
    const pdfLibraries = Object.keys(all).filter((name) => /pdf/i.test(name))

    expect(pdfLibraries).toEqual(['pdfjs-dist'])
  })
})
