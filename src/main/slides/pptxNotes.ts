import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * Read the speaker notes out of a .pptx.
 *
 * A .pptx is a zip of XML, so this needs no library and no rendering engine — which matters,
 * because the notes are usable even when the slides themselves cannot be rendered on this
 * machine. Notes are narration someone has already written.
 */
export async function readPptxNotes(pptxPath: string): Promise<string[]> {
  const slideOrder = await readSlideOrder(pptxPath)
  const notes: string[] = []

  for (const slideName of slideOrder) {
    notes.push(await readNotesForSlide(pptxPath, slideName))
  }

  return notes
}

/**
 * Slides are numbered by their file name, not by the order they appear in. `presentation.xml`
 * holds the real order, via relationship ids — so slide10 can come before slide2.
 */
export async function readSlideOrder(pptxPath: string): Promise<string[]> {
  const presentation = await readEntry(pptxPath, 'ppt/presentation.xml')
  const rels = await readEntry(pptxPath, 'ppt/_rels/presentation.xml.rels')
  if (!presentation || !rels) return []

  const target = new Map<string, string>()
  for (const match of rels.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const id = match[0].match(/Id="([^"]+)"/)?.[1]
    const path = match[0].match(/Target="([^"]+)"/)?.[1]
    if (id && path?.includes('slides/slide')) {
      target.set(id, path.replace(/^\.\.\//, '').replace(/^\/?ppt\//, ''))
    }
  }

  const ordered: string[] = []
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)) {
    const path = target.get(match[1])
    if (path) ordered.push(path.replace(/^slides\//, ''))
  }

  return ordered
}

async function readNotesForSlide(pptxPath: string, slideName: string): Promise<string> {
  const rels = await readEntry(pptxPath, `ppt/slides/_rels/${slideName}.rels`)
  if (!rels) return ''

  const notesTarget = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)]
    .map((match) => match[0].match(/Target="([^"]+)"/)?.[1])
    .find((path) => path?.includes('notesSlide'))
  if (!notesTarget) return ''

  const notesPath = `ppt/${notesTarget.replace(/^\.\.\//, '')}`
  const xml = await readEntry(pptxPath, notesPath)
  return xml ? extractNotesText(xml) : ''
}

/**
 * Pull the spoken text out of a notes slide.
 *
 * Notes carry the slide number as a field alongside the words; reading that aloud would put a
 * stray digit in the narration, so field runs are dropped. Paragraphs become line breaks.
 */
export function extractNotesText(xml: string): string {
  const body = xml.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/g)?.join('') ?? xml

  const paragraphs: string[] = []
  for (const paragraph of body.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
    const withoutFields = paragraph[1].replace(/<a:fld[\s\S]*?<\/a:fld>/g, '')
    const text = [...withoutFields.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXml(match[1]))
      .join('')
    if (text.trim()) paragraphs.push(text.trim())
  }

  return paragraphs.join('\n')
}

export function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}

/** Read one file out of the zip without unpacking the whole archive. */
export async function readEntry(zipPath: string, entry: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('unzip', ['-p', zipPath, entry], {
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf-8'
    })
    return stdout || null
  } catch {
    // A deck may simply have no notes for a slide, which unzip reports as a failure.
    return null
  }
}
