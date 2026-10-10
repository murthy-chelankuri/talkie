import type { BrandFacts } from './facts'

/** Words a brand guide puts before a font's name. */
// The label in any case, the name capitalised as names are: case-insensitive throughout would
// read "Typeface: used for headings" as a font called "used".
const FONT_LABEL = /(?:[Tt]ypeface|[Ff]ont(?:\s+[Ff]amily)?|[Tt]ypography|TYPEFACE|FONT)\s*[:\-–—]\s*([A-Z][A-Za-z0-9]*(?:\s[A-Z][A-Za-z0-9]*){0,2})/g

/**
 * The colours and typefaces a brand guide states outright.
 *
 * A guide says "#635BFF" and "Typeface: Inter" in so many words, which is better evidence than
 * anything read off a website — so only what is written is taken, and nothing is guessed. Text
 * is pulled with pdfjs, which Talkie already uses to import decks; colours earlier in the
 * document count for more, since guides lead with the primary colour.
 */
export async function readBrandGuide(bytes: Buffer): Promise<BrandFacts> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false })
  let text = ''
  try {
    const pdf = await loading.promise
    for (let number = 1; number <= Math.min(pdf.numPages, 40); number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      text += content.items.map((item) => ('str' in item ? item.str : '')).join('\n') + '\n'
    }
  } finally {
    await loading.destroy()
  }

  const hexes = [...text.matchAll(/#([0-9a-f]{6})\b/gi)].map((match) => `#${match[1].toLowerCase()}`)
  const unique = hexes.filter((hex, i) => hexes.indexOf(hex) === i)
  const fonts = [...text.matchAll(FONT_LABEL)].map((match) => match[1].trim())

  return {
    colours: unique.map((hex, i) => ({ hex, weight: (unique.length - i) * 1000, role: 'document' as const })),
    fonts: fonts.filter((font, i) => fonts.indexOf(font) === i).map((family) => ({ family, role: 'document' as const })),
    sources: ['pdf'],
    problems: []
  }
}
