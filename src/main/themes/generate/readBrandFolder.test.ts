import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { readBrandFolder } from './readBrandFolder'
import { NO_FACTS, type BrandFacts } from './facts'

function folder(): string {
  return mkdtempSync(join(tmpdir(), 'brand-folder-'))
}

// A fake logo reader, so the test does not launch a browser; it reports a light-ink logo.
const fakeDeps = {
  readLogo: async (): Promise<BrandFacts> => ({ ...NO_FACTS, colours: [{ hex: '#ffffff', weight: 1, role: 'logo' }], sources: ['logo'] }),
  readBrandGuide: async (): Promise<BrandFacts> => NO_FACTS
}

describe('readBrandFolder', () => {
  it('collects fonts, a logo and a background from a directory', async () => {
    const dir = folder()
    writeFileSync(join(dir, 'AcmeSans.otf'), Buffer.from('OTTO'))
    writeFileSync(join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#ffffff"/></svg>')
    writeFileSync(join(dir, 'hero.jpg'), Buffer.from('JPEG'))
    const facts = await readBrandFolder(dir, fakeDeps)
    expect(facts.sources).toContain('folder')
    expect(facts.fonts.some((f) => f.family === 'AcmeSans')).toBe(true)
    expect(facts.logos?.length).toBe(1)
    expect(facts.logos?.[0].ink).toBe('light')
    expect(facts.backgrounds?.length).toBe(1)
    // The logo's own colours reach the facts, so the AI designs from them as it does for a website.
    expect(facts.colours.some((c) => c.hex === '#ffffff' && c.role === 'logo')).toBe(true)
  })

  it('reads hex colours and font labels out of a text brand note', async () => {
    const dir = folder()
    writeFileSync(join(dir, 'guide.md'), '# Brand\nPrimary #112233\nTypeface: Inter')
    const facts = await readBrandFolder(dir, fakeDeps)
    expect(facts.colours.some((c) => c.hex === '#112233')).toBe(true)
    expect(facts.palette?.some((p) => p.hex === '#112233')).toBe(true)
    expect(facts.fonts.some((f) => f.family === 'Inter')).toBe(true)
  })
})
