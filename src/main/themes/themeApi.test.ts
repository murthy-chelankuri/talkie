import { existsSync, mkdtempSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MAX_BACKGROUND_BYTES, writeAssetInto } from './themeApi'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'theme-assets-'))
}

describe('writeAssetInto', () => {
  it('writes a logo slot into logos/ and names it for the slot', () => {
    const dir = tempDir()
    const path = writeAssetInto(dir, 'logo', 'light', 'brand-white.svg', Buffer.from('<svg/>'))
    expect(path).toBe('logos/light.svg')
    expect(existsSync(join(dir, 'logos/light.svg'))).toBe(true)
  })

  it('replaces the previous file in a logo slot rather than leaving both', () => {
    const dir = tempDir()
    writeAssetInto(dir, 'logo', 'dark', 'a.svg', Buffer.from('<svg/>'))
    writeAssetInto(dir, 'logo', 'dark', 'b.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(readdirSync(join(dir, 'logos'))).toEqual(['dark.png'])
  })

  it('writes a background slot into backgrounds/ verbatim', () => {
    const dir = tempDir()
    const bytes = Buffer.from('JPEGBYTES')
    const path = writeAssetInto(dir, 'background', 'card-dark', 'hero.jpg', bytes)
    expect(path).toBe('backgrounds/card-dark.jpg')
    expect(existsSync(join(dir, 'backgrounds/card-dark.jpg'))).toBe(true)
  })

  it('refuses a background that is not an image', () => {
    const dir = tempDir()
    expect(() => writeAssetInto(dir, 'background', 'card-dark', 'notes.txt', Buffer.from('x'))).toThrow()
  })

  it('refuses a background over the ceiling', () => {
    const dir = tempDir()
    const big = Buffer.alloc(MAX_BACKGROUND_BYTES + 1)
    expect(() => writeAssetInto(dir, 'background', 'content-light', 'huge.png', big)).toThrow()
  })

  it('still writes a font into fonts/', () => {
    const dir = tempDir()
    const path = writeAssetInto(dir, 'font', '', 'AcmeSans.otf', Buffer.from('OTTO'))
    expect(path).toBe('fonts/AcmeSans.otf')
  })
})
