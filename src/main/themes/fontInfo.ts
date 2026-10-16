import { brotliDecompressSync, inflateSync } from 'zlib'

export { describeFace } from './fontFace'

/**
 * What a font file says about itself: the family it belongs to, and which face of it this is.
 *
 * A company's own fonts arrive as a handful of files — Acme Sans Regular, Bold, Italic — and every
 * one says inside it which family it is, how heavy and whether it slants. The names of the files
 * say none of that reliably (`AcmeSans-Bd.otf`), and reading the weight off the name made every
 * bold a regular. So the file is asked: the name table for the family, the OS/2 table for the
 * weight and slant. TTF and OTF hold those tables as they are; WOFF compresses each with zlib, and
 * WOFF2 compresses them all together with Brotli behind a packed directory — both of which Node
 * can undo, so no font library is needed.
 */
export type FontInfo = {
  /** "Acme Sans" — the family a person picks by name. */
  family: string
  /** "Bold Italic", "SemiBold" — the face's own name for itself. */
  face: string
  /** 100–900, as CSS counts. */
  weight: number
  italic: boolean
  /** One file holding every weight (an `fvar` table): drawn at whatever weight is asked for. */
  variable: boolean
}

type Tables = Map<string, Buffer>

/** The font's name, weight and slant; null for a file that is not a font Talkie can read. */
export function readFontInfo(bytes: Buffer): FontInfo | null {
  try {
    const tables = readTables(bytes)
    if (!tables) return null
    const names = tables.get('name')
    if (!names) return null
    const family = nameOf(names, 16) ?? nameOf(names, 1)
    if (!family) return null
    const face = nameOf(names, 17) ?? nameOf(names, 2) ?? 'Regular'
    const os2 = tables.get('OS/2')
    const weight = os2 && os2.length >= 6 ? os2.readUInt16BE(4) : weightFromName(face)
    // fsSelection: bit 0 italic, bit 9 oblique.
    const italic = os2 && os2.length >= 64 ? (os2.readUInt16BE(62) & 0x201) !== 0 : /italic|oblique/i.test(face)
    return {
      family: family.trim(),
      face: face.trim(),
      weight: clampWeight(weight),
      italic: italic || /italic|oblique/i.test(face),
      variable: tables.has('fvar')
    }
  } catch {
    return null
  }
}

function clampWeight(weight: number): number {
  if (!Number.isFinite(weight) || weight < 1) return 400
  return Math.min(900, Math.max(100, Math.round(weight / 100) * 100 || 400))
}

/** A weight read off a face's name, for the rare file with no OS/2 table. */
export function weightFromName(name: string): number {
  const words: [RegExp, number][] = [
    [/thin|hairline/i, 100],
    [/extra\s*light|ultra\s*light/i, 200],
    [/light/i, 300],
    [/medium/i, 500],
    [/semi\s*bold|demi\s*bold/i, 600],
    [/extra\s*bold|ultra\s*bold/i, 800],
    [/black|heavy/i, 900],
    [/bold/i, 700]
  ]
  return words.find(([pattern]) => pattern.test(name))?.[1] ?? 400
}

function readTables(bytes: Buffer): Tables | null {
  const signature = bytes.toString('latin1', 0, 4)
  if (signature === 'wOFF') return readWoff(bytes)
  if (signature === 'wOF2') return readWoff2(bytes)
  if (signature === '\x00\x01\x00\x00' || signature === 'OTTO' || signature === 'true') return readSfnt(bytes)
  return null
}

/** TTF and OTF: a table directory pointing straight at each table. */
function readSfnt(bytes: Buffer): Tables {
  const tables: Tables = new Map()
  const count = bytes.readUInt16BE(4)
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16
    const tag = bytes.toString('latin1', at, at + 4)
    const offset = bytes.readUInt32BE(at + 8)
    const length = bytes.readUInt32BE(at + 12)
    tables.set(tag, bytes.subarray(offset, offset + length))
  }
  return tables
}

/** WOFF: the same tables, each deflated on its own where that made it smaller. */
function readWoff(bytes: Buffer): Tables {
  const tables: Tables = new Map()
  const count = bytes.readUInt16BE(12)
  for (let i = 0; i < count; i += 1) {
    const at = 44 + i * 20
    const tag = bytes.toString('latin1', at, at + 4)
    if (tag === 'fvar') tables.set(tag, Buffer.alloc(0))
    if (tag !== 'name' && tag !== 'OS/2') continue
    const offset = bytes.readUInt32BE(at + 4)
    const compressed = bytes.readUInt32BE(at + 8)
    const length = bytes.readUInt32BE(at + 12)
    const stored = bytes.subarray(offset, offset + compressed)
    tables.set(tag, compressed < length ? inflateSync(stored) : stored)
  }
  return tables
}

/** The tags WOFF2 abbreviates to an index, in the order the format fixes. */
const WOFF2_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'
]

/**
 * WOFF2: one Brotli stream of every table end to end, after a directory written in variable-length
 * numbers. Only glyf, loca and hmtx are ever transformed, and the two tables read here never are.
 */
function readWoff2(bytes: Buffer): Tables {
  const count = bytes.readUInt16BE(12)
  const compressedSize = bytes.readUInt32BE(20)
  let at = 48
  const base128 = (): number => {
    let value = 0
    for (let i = 0; i < 5; i += 1) {
      const byte = bytes[at++]
      value = value * 128 + (byte & 0x7f)
      if ((byte & 0x80) === 0) return value
    }
    throw new Error('A WOFF2 number ran on too long.')
  }
  const entries: { tag: string; length: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const flags = bytes[at++]
    let tag: string
    if ((flags & 0x3f) === 0x3f) {
      tag = bytes.toString('latin1', at, at + 4)
      at += 4
    } else {
      tag = WOFF2_TAGS[flags & 0x3f]
    }
    const original = base128()
    const transform = (flags >> 6) & 3
    // glyf and loca are transformed unless the version says not; anything else only if it says so.
    const transformed = tag === 'glyf' || tag === 'loca' ? transform === 0 : transform !== 0
    entries.push({ tag, length: transformed ? base128() : original })
  }
  const stream = brotliDecompressSync(bytes.subarray(at, at + compressedSize))
  const tables: Tables = new Map()
  let offset = 0
  for (const { tag, length } of entries) {
    if (tag === 'name' || tag === 'OS/2') tables.set(tag, stream.subarray(offset, offset + length))
    if (tag === 'fvar') tables.set(tag, Buffer.alloc(0))
    offset += length
  }
  return tables
}

/**
 * One entry of the name table: the Windows English one where there is one (UTF-16), the Mac one
 * (one byte a character) otherwise.
 */
function nameOf(table: Buffer, id: number): string | undefined {
  const count = table.readUInt16BE(2)
  const strings = table.readUInt16BE(4)
  let fallback: string | undefined
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 12
    const platform = table.readUInt16BE(at)
    const language = table.readUInt16BE(at + 4)
    if (table.readUInt16BE(at + 6) !== id) continue
    const length = table.readUInt16BE(at + 8)
    const start = strings + table.readUInt16BE(at + 10)
    const raw = table.subarray(start, start + length)
    if (platform === 3 || platform === 0) {
      // Big-endian UTF-16, swapped on a copy: the table belongs to the file.
      const copy = Buffer.from(raw.subarray(0, raw.length - (raw.length % 2)))
      const text = copy.swap16().toString('utf16le')
      if (platform === 3 && language === 0x409) return text
      fallback ??= text
    } else if (platform === 1) {
      fallback ??= raw.toString('latin1')
    }
  }
  return fallback
}
