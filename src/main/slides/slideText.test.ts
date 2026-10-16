import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { slideTextFromPdf, slideTextOrNull, type PdfTextItem } from './slideText'
import { extractSlideText, readPptxSlideTexts } from './pptxSlides'

/** A run of text as pdf.js gives it: size, then where it starts, its baseline, and how wide it is. */
const run = (str: string, size: number, x: number, y: number, width = str.length * size * 0.5): PdfTextItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width
})

describe('reading the words off a PDF page', () => {
  it('takes the largest text at the top as the title, and each line under it as a point', () => {
    const text = slideTextFromPdf([
      run('Next steps', 54, 60, 640),
      run('Hire two engineers', 30, 80, 540),
      run('Launch in Japan', 30, 80, 500)
    ])
    expect(text).toEqual({ title: 'Next steps', bullets: ['Hire two engineers', 'Launch in Japan'] })
  })

  it('joins a point that wrapped back into one, and keeps short points apart', () => {
    const text = slideTextFromPdf([
      run('Q3 results', 54, 60, 640),
      run('• Revenue up 18% on last year, driven by the enterprise plan', 30, 80, 540, 1000),
      run('and the new partner channel in Europe', 30, 100, 504, 560),
      run('• Churn down to 2.1%', 30, 80, 460, 300)
    ])
    expect(text.bullets).toEqual([
      'Revenue up 18% on last year, driven by the enterprise plan and the new partner channel in Europe',
      'Churn down to 2.1%'
    ])
  })

  it('puts runs on one baseline together in reading order, whatever order they arrive in', () => {
    const text = slideTextFromPdf([run('works', 54, 260, 640), run('How it', 54, 60, 640), run('Capture a session', 30, 80, 540)])
    expect(text.title).toBe('How it works')
  })

  it('drops the marks decks put before points, and a page number on its own', () => {
    const text = slideTextFromPdf([run('Plan', 54, 60, 640), run('1. Hire', 30, 80, 540), run('2. Launch', 30, 80, 500), run('7', 14, 1200, 20)])
    expect(text.bullets).toEqual(['Hire', 'Launch'])
  })

  it('escapes what would otherwise read as markup, since a slide’s text is rich text', () => {
    expect(slideTextFromPdf([run('<b>Tickets</b> & SLAs', 54, 60, 640)]).title).toBe('&lt;b&gt;Tickets&lt;/b&gt; &amp; SLAs')
  })

  it('finds nothing on a page that is only a picture', () => {
    expect(slideTextFromPdf([])).toEqual({ title: '', bullets: [] })
  })
})

describe('reading the words off a .pptx', () => {
  it('reads every slide in the deck’s order, title from the title box and the rest as points', async () => {
    expect(await readPptxSlideTexts(join(__dirname, 'fixtures', 'two-slides-with-notes.pptx'))).toEqual([
      { title: 'Talkie Overview', bullets: ['Record. Narrate. Export.'] },
      { title: 'How it works', bullets: ['Capture a session', 'Draft the narration', 'Export an MP4'] }
    ])
  })

  it('leaves out the slide number, date and footer', () => {
    const shape = (type: string, text: string): string =>
      `<p:sp><p:nvSpPr><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
    const xml = shape('title', 'Pricing') + shape('body', 'Three plans') + shape('sldNum', '4') + shape('ftr', 'Confidential')
    expect(extractSlideText(xml)).toEqual({ title: 'Pricing', bullets: ['Three plans'] })
  })
})

describe('the text a slide is given', () => {
  it('promotes the first point to the title where a page has no title of its own', () => {
    expect(slideTextOrNull({ title: '', bullets: ['A', 'B'] })).toEqual({ title: 'A', bullets: ['B'] })
  })

  it('is nothing for a page with no words, which stays a picture', () => {
    expect(slideTextOrNull({ title: ' ', bullets: [] })).toBeNull()
  })
})
