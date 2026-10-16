import { decodeXml, readEntry, readSlideOrder } from './pptxNotes'
import { escapeSlideText, type SlideText } from './slideText'

/**
 * The words on each slide of a .pptx, in the deck's order, read from its XML.
 *
 * Better than reading them back off the PDF LibreOffice makes: a .pptx says outright which box is
 * the title, and keeps each point a paragraph of its own however it wraps on the page.
 */
export async function readPptxSlideTexts(pptxPath: string): Promise<SlideText[]> {
  const texts: SlideText[] = []
  for (const slideName of await readSlideOrder(pptxPath)) {
    const xml = await readEntry(pptxPath, `ppt/slides/${slideName}`)
    texts.push(xml ? extractSlideText(xml) : { title: '', bullets: [] })
  }
  return texts
}

/** Placeholders that carry the slide number, date or footer: furniture, not what the slide says. */
const FURNITURE = new Set(['sldNum', 'dt', 'ftr', 'hdr'])

/**
 * The title and points of one slide's XML. The title is the shape marked as one (`title` or
 * `ctrTitle`); every other shape's paragraphs are points, in the order the slide holds them.
 */
export function extractSlideText(xml: string): SlideText {
  let title = ''
  const bullets: string[] = []
  for (const shape of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    const placeholder = shape[0].match(/<p:ph\b[^>]*?type="([^"]+)"/)?.[1]
    if (placeholder && FURNITURE.has(placeholder)) continue
    const paragraphs = [...shape[0].matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p\b[^/]*?>([\s\S]*?)<\/a:p>/g)]
      .map((match) => paragraphText(match[1] ?? match[2] ?? ''))
      .filter(Boolean)
    if (!title && (placeholder === 'title' || placeholder === 'ctrTitle')) title = paragraphs.join(' ')
    else bullets.push(...paragraphs)
  }
  return { title: escapeSlideText(title), bullets: bullets.map(escapeSlideText) }
}

function paragraphText(paragraph: string): string {
  return paragraph
    .replace(/<a:br\b[^>]*\/>/g, '<a:t> </a:t>')
    .replace(/<a:fld[\s\S]*?<\/a:fld>/g, '')
    .match(/<a:t>[\s\S]*?<\/a:t>/g)
    ?.map((run) => decodeXml(run.slice(5, -6)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim() ?? ''
}
