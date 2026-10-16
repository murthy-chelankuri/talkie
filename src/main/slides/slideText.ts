/**
 * The words on an imported slide, as a title and the points under it — what a Talkie slide is made
 * of — so a deck arrives as slides that can be edited rather than only as pictures of pages.
 *
 * No Node here: the window reads a PDF's text as it draws the pages (renderPdfPages.ts), the MCP
 * server as it rasterises them (rasterisePdf.ts), and both call this. A .pptx is read from its
 * own XML instead (pptxSlides.ts), which says outright which box is the title.
 */

export type SlideText = { title: string; bullets: string[] }

/** One run of text as pdf.js reports it: the string, and where and how large it is drawn. */
export type PdfTextItem = { str: string; transform: number[]; width?: number }

/**
 * A slide's text is set as rich text, which is markup (see richText.ts). Words taken from a deck
 * are words, so anything that would read as a tag is escaped rather than trusted.
 */
export function escapeSlideText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The marks decks put in front of a point, which a Talkie slide draws for itself. */
const BULLET_MARK = /^\s*(?:[•●○◦▪▫■□◆◇►▶➢➤✓✔\-–—*·]|\d{1,2}[.)])\s+/

type Line = { text: string; size: number; y: number; x: number; right: number }

/**
 * The title and points of one PDF page, from where its text sits and how large it is.
 *
 * A PDF has no idea which text is a title, only runs of characters at positions. So: runs on the
 * same baseline are one line; the largest text near the top is the title, joined if it wraps;
 * every other line is a point, in reading order, with a line that only continues the one above
 * joined back to it. A page number on its own is not a point.
 */
export function slideTextFromPdf(items: PdfTextItem[]): SlideText {
  const runs = items
    .filter((item) => item.str.trim())
    .map((item) => ({
      text: item.str,
      size: Math.hypot(item.transform[2], item.transform[3]) || Math.abs(item.transform[3]) || 1,
      x: item.transform[4],
      y: item.transform[5],
      right: item.transform[4] + (item.width ?? 0)
    }))
  if (runs.length === 0) return { title: '', bullets: [] }

  // Top of the page first: PDF measures y up from the bottom.
  runs.sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: Line[] = []
  for (const run of runs) {
    const line = lines.find((each) => Math.abs(each.y - run.y) < Math.max(each.size, run.size) * 0.4)
    if (line) {
      const gap = run.x > line.x && !line.text.endsWith(' ') && !run.text.startsWith(' ') ? ' ' : ''
      line.text = run.x >= line.x ? `${line.text}${gap}${run.text}` : `${run.text}${gap}${line.text}`
      line.size = Math.max(line.size, run.size)
      line.x = Math.min(line.x, run.x)
      line.right = Math.max(line.right, run.right)
    } else {
      lines.push({ ...run })
    }
  }
  for (const line of lines) line.text = line.text.replace(/\s+/g, ' ').trim()
  const kept = lines.filter((line) => line.text && !/^\d{1,3}$/.test(line.text))
  if (kept.length === 0) return { title: '', bullets: [] }

  // The title: the largest text in the top half of what is on the page, with the lines that
  // continue it at the same size directly beneath.
  const largest = Math.max(...kept.slice(0, Math.max(1, Math.ceil(kept.length / 2))).map((line) => line.size))
  const first = kept.findIndex((line) => line.size >= largest * 0.9)
  let end = first + 1
  while (end < kept.length && kept[end].size >= largest * 0.9 && kept[end - 1].y - kept[end].y < kept[end].size * 1.8) end += 1
  const title = kept.slice(first, end).map((line) => line.text).join(' ')

  // How far across the page the text reaches: a line only wraps once it has run that far.
  const margin = Math.max(...kept.map((line) => line.right))
  const bullets: string[] = []
  let previous: Line | null = null
  for (const [index, line] of kept.entries()) {
    if (index >= first && index < end) continue
    const marked = BULLET_MARK.test(line.text)
    const text = line.text.replace(BULLET_MARK, '').trim()
    if (!text) continue
    // A wrapped point: no mark of its own, the same size, close beneath a line that ran nearly to
    // the edge of the text, and reading as the middle of a sentence — starting lower-case, or
    // after a comma. Short points one under another, each a capitalised phrase, are separate
    // points, which is most decks; the width alone cannot tell, since one of them is the widest.
    const last = bullets[bullets.length - 1] ?? ''
    const continues =
      previous !== null &&
      !marked &&
      bullets.length > 0 &&
      Math.abs(line.size - previous.size) < 0.5 &&
      previous.y - line.y < line.size * 1.8 &&
      previous.right >= previous.x + (margin - previous.x) * 0.8 &&
      !/[.!?:]$/.test(last) &&
      (/^\p{Ll}/u.test(text) || /[,;\u2013\u2014-]$/.test(last))
    if (continues) bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${text}`
    else bullets.push(text)
    previous = line
  }

  return { title: escapeSlideText(title), bullets: bullets.map(escapeSlideText) }
}

/**
 * The text to give a Talkie slide: the title, or — where a page has points but nothing that reads
 * as a title — its first point promoted, since a slide is not saved without one.
 */
export function slideTextOrNull(text: SlideText | undefined): SlideText | null {
  if (!text) return null
  const bullets = text.bullets.filter((line) => line.trim())
  if (text.title.trim()) return { title: text.title.trim(), bullets }
  if (bullets.length > 0) return { title: bullets[0], bullets: bullets.slice(1) }
  return null
}
