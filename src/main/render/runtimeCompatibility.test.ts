import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Guards against a class of bug that unit tests cannot see.
 *
 * Slide import rasterises PDFs in the renderer, which is Electron's Chromium, not the Node these
 * tests run under. pdfjs 6 calls `Uint8Array.prototype.toHex`; Node had it and Electron 32's
 * Chromium 128 did not, so importing a deck failed at runtime with "n.toHex is not a function"
 * while every test passed. Chromium 152 has it, which is what allowed pdfjs to be raised again.
 *
 * The pairing is what matters, so this fails whenever either side moves — not because the new
 * pair is wrong, but because nothing else will make anyone check it in the renderer.
 */
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf-8')
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

function majorOf(range: string): number {
  return Number(range.replace(/^[^\d]*/, '').split('.')[0])
}

/** The pair last checked together by importing a real deck in the packaged renderer. */
const CHECKED_TOGETHER = { electron: 44, pdfjs: 6 }

describe('renderer runtime compatibility', () => {
  it('still has the pdf library the importer needs', () => {
    expect(packageJson.dependencies?.['pdfjs-dist'], 'pdfjs-dist is no longer a dependency').toBeTruthy()
  })

  it('has not moved either side of a pairing that was checked together', () => {
    const electron = packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron
    const pdfjs = packageJson.dependencies?.['pdfjs-dist']

    // If this fails, one of them moved. Import a deck in the built app before updating the pair:
    // nothing else exercises pdfjs against Electron's Chromium rather than against Node.
    expect({ electron: majorOf(electron as string), pdfjs: majorOf(pdfjs as string) }).toEqual(
      CHECKED_TOGETHER
    )
  })

  it('has not quietly picked up a second pdf library to drift out of step with', () => {
    const all = { ...packageJson.dependencies, ...packageJson.devDependencies }
    const pdfLibraries = Object.keys(all).filter((name) => /pdf/i.test(name))

    expect(pdfLibraries).toEqual(['pdfjs-dist'])
  })
})
