import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { deflateSync } from 'zlib'
import { describeFace, readFontInfo, weightFromName } from './fontInfo'
import { addFontInto } from './themeApi'
import { fontFaceCss } from '../../composition/renderTheme'

const SUPPLEMENTAL = '/System/Library/Fonts/Supplemental'
const georgia = (style: string): string => join(SUPPLEMENTAL, `Georgia${style}.ttf`)
const haveGeorgia = existsSync(georgia(' Bold Italic'))
const GEIST = join(__dirname, '..', '..', '..', 'node_modules', '@fontsource-variable', 'geist', 'files', 'geist-latin-wght-normal.woff2')

/** A TTF wrapped as WOFF, every table deflated, the way a font foundry ships one. */
function asWoff(ttf: Buffer): Buffer {
  const count = ttf.readUInt16BE(4)
  const tables = Array.from({ length: count }, (_, i) => {
    const at = 12 + i * 16
    const data = ttf.subarray(ttf.readUInt32BE(at + 8), ttf.readUInt32BE(at + 8) + ttf.readUInt32BE(at + 12))
    return { tag: ttf.subarray(at, at + 4), checksum: ttf.readUInt32BE(at + 4), data, packed: deflateSync(data) }
  })
  const header = Buffer.alloc(44 + count * 20)
  header.write('wOFF', 0, 'latin1')
  header.writeUInt32BE(ttf.readUInt32BE(0), 4)
  header.writeUInt16BE(count, 12)
  let offset = header.length
  tables.forEach((table, i) => {
    const at = 44 + i * 20
    table.tag.copy(header, at)
    header.writeUInt32BE(offset, at + 4)
    header.writeUInt32BE(table.packed.length, at + 8)
    header.writeUInt32BE(table.data.length, at + 12)
    header.writeUInt32BE(table.checksum, at + 16)
    offset += table.packed.length + ((4 - (table.packed.length % 4)) % 4)
  })
  return Buffer.concat([header, ...tables.flatMap((table) => [table.packed, Buffer.alloc((4 - (table.packed.length % 4)) % 4)])])
}

describe('reading what a font file is', () => {
  it.skipIf(!haveGeorgia)('reads the family, weight and slant of each face of a TTF family', () => {
    expect(readFontInfo(readFileSync(georgia('')))).toMatchObject({ family: 'Georgia', weight: 400, italic: false })
    expect(readFontInfo(readFileSync(georgia(' Bold')))).toMatchObject({ family: 'Georgia', weight: 700, italic: false })
    expect(readFontInfo(readFileSync(georgia(' Italic')))).toMatchObject({ family: 'Georgia', weight: 400, italic: true })
    expect(readFontInfo(readFileSync(georgia(' Bold Italic')))).toMatchObject({ family: 'Georgia', face: 'Bold Italic', weight: 700, italic: true })
  })

  it.skipIf(!haveGeorgia)('reads a WOFF, whose tables are each compressed', () => {
    expect(readFontInfo(asWoff(readFileSync(georgia(' Bold Italic'))))).toMatchObject({ family: 'Georgia', weight: 700, italic: true })
  })

  it('reads a WOFF2, and knows a variable font covers every weight', () => {
    expect(readFontInfo(readFileSync(GEIST))).toEqual({ family: 'Geist', face: 'Regular', weight: 400, italic: false, variable: true })
  })

  it('turns away anything that is not a font', () => {
    expect(readFontInfo(Buffer.from('%PDF-1.7 not a font'))).toBeNull()
    expect(readFontInfo(Buffer.from('wOF2 broken'))).toBeNull()
  })

  it('names faces and weights the way people say them', () => {
    expect(describeFace(700, true)).toBe('Bold Italic')
    expect(describeFace(400, true)).toBe('Italic')
    expect(weightFromName('Acme Sans SemiBold')).toBe(600)
    expect(weightFromName('Acme Sans Bold')).toBe(700)
  })
})

describe('a company’s own font in a theme', () => {
  it.skipIf(!haveGeorgia)('is kept with what it is, and a file that is not a font is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'talkie-theme-font-'))
    try {
      expect(addFontInto(dir, 'Georgia Bold Italic.ttf', readFileSync(georgia(' Bold Italic')))).toMatchObject({
        file: 'fonts/Georgia-Bold-Italic.ttf',
        family: 'Georgia',
        weight: 700,
        italic: true
      })
      expect(() => addFontInto(dir, 'brand.otf', Buffer.from('not a font'))).toThrow(/brand\.otf is not a font Talkie can read/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is declared at the weight and slant the file says, so a regular and a bold do not fight', () => {
    // `AcmeSans-Bold` names no number: it was declared as every weight, like the regular beside it.
    const css = fontFaceCss({
      fonts: {
        heading: {
          family: 'Acme Sans',
          urls: ['data:font/otf;name=AcmeSans-Regular;weight=400;style=normal;base64,AA', 'data:font/otf;name=AcmeSans-BoldItalic;weight=700;style=italic;base64,AA']
        },
        body: { family: 'Inter', urls: ['data:font/woff2;name=Inter-600;weight=100-900;style=normal;base64,AA'] }
      }
    } as never)
    expect(css).toContain('font-family:"Acme Sans";src:url(data:font/otf;name=AcmeSans-Regular;weight=400;style=normal;base64,AA);font-weight:400;font-style:normal')
    expect(css).toContain('font-weight:700;font-style:italic')
    // Talkie's own downloads keep the weight their name gives them.
    expect(css).toContain('name=Inter-600;weight=100-900;style=normal;base64,AA);font-weight:600')
  })
})
