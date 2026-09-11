import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { readPptxNotes, extractNotesText } from './pptxNotes'

// A real .pptx exported by Keynote, not a hand-built archive: the point is to parse what
// presentation software actually writes.
const DECK = join(__dirname, 'fixtures', 'two-slides-with-notes.pptx')

describe('readPptxNotes', () => {
  it('reads the notes of every slide, in the order they are presented', async () => {
    const notes = await readPptxNotes(DECK)

    expect(notes).toEqual([
      'Welcome to Talkie. It turns a silent screen recording into a narrated demo.',
      'You record a browser session, the agent drafts the words, and you export the video.'
    ])
  })

  it('returns nothing for a file that is not a deck', async () => {
    expect(await readPptxNotes(join(__dirname, 'pptxNotes.ts'))).toEqual([])
  })
})

describe('extractNotesText', () => {
  it('drops the slide-number field so it is never read aloud', () => {
    const xml = `<p:txBody><a:p>
        <a:fld id="x" type="slidenum"><a:t>7</a:t></a:fld>
        <a:r><a:t>The words that matter.</a:t></a:r>
      </a:p></p:txBody>`

    expect(extractNotesText(xml)).toBe('The words that matter.')
  })

  it('joins the runs a single sentence gets split into', () => {
    // Presentation software splits a sentence at every formatting change.
    const xml = '<p:txBody><a:p><a:r><a:t>Bold</a:t></a:r><a:r><a:t> and plain.</a:t></a:r></a:p></p:txBody>'

    expect(extractNotesText(xml)).toBe('Bold and plain.')
  })

  it('keeps separate paragraphs on separate lines', () => {
    const xml = '<p:txBody><a:p><a:r><a:t>First.</a:t></a:r></a:p><a:p><a:r><a:t>Second.</a:t></a:r></a:p></p:txBody>'

    expect(extractNotesText(xml)).toBe('First.\nSecond.')
  })

  it('decodes escaped characters rather than reading them out', () => {
    const xml = '<p:txBody><a:p><a:r><a:t>Tom &amp; Jerry &quot;live&quot;</a:t></a:r></a:p></p:txBody>'

    expect(extractNotesText(xml)).toBe('Tom & Jerry "live"')
  })

  it('gives back nothing for a slide with no notes', () => {
    expect(extractNotesText('<p:txBody><a:p></a:p></p:txBody>')).toBe('')
  })
})
