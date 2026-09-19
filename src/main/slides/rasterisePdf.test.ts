import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { rasterisePdf } from './rasterisePdf'

/** A real multi-page PDF, made with what macOS already has rather than checked in. */
function threePagePdf(dir: string): Uint8Array {
  const txt = join(dir, 'deck.txt')
  const pdf = join(dir, 'deck.pdf')
  writeFileSync(txt, 'Page one\n\f\nPage two\n\f\nPage three\n')
  writeFileSync(pdf, execFileSync('/usr/sbin/cupsfilter', [txt], { maxBuffer: 16 * 1024 * 1024 }))
  return new Uint8Array(readFileSync(pdf))
}

describe('turning a PDF into slides without a browser', () => {
  it('renders every page, not just the first', async () => {
    // The whole reason deck import had no agent tool: rasterising was done in the renderer,
    // and everything macOS offers on the command line gives you page one and stops.
    const dir = mkdtempSync(join(tmpdir(), 'talkie-raster-'))

    const pages = await rasterisePdf(threePagePdf(dir))

    expect(pages).toHaveLength(3)
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  it('renders real PNGs at the width the composition wants', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'talkie-raster-size-'))

    const [first] = await rasterisePdf(threePagePdf(dir))

    // PNG magic, so this is an image rather than an empty buffer that happens to be the right
    // length.
    expect(Array.from(first.png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(first.png.length).toBeGreaterThan(1000)
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  it('gives back nothing for a PDF with no pages rather than throwing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'talkie-raster-empty-'))

    // Not a PDF at all: the failure has to be the caller's to report, not a crash.
    await expect(rasterisePdf(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow()

    rmSync(dir, { recursive: true, force: true })
  }, 60_000)
})
