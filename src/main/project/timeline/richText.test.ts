import { describe, expect, it } from 'vitest'
import { sanitiseRichText, richTextToPlain, plainToRichText } from './richText'

describe('sanitiseRichText', () => {
  it('keeps the formatting a slide is allowed to use', () => {
    const html = '<strong>Record</strong> then <em>narrate</em><br><u>then export</u>'

    expect(sanitiseRichText(html)).toBe(html)
  })

  it('keeps a colour on a run of words', () => {
    expect(sanitiseRichText('<span style="color:#d3a24c">brass</span>')).toBe(
      '<span style="color:#d3a24c">brass</span>'
    )
  })

  it('accepts rgb as well as hex', () => {
    expect(sanitiseRichText('<span style="color:rgb(211, 162, 76)">x</span>')).toContain('rgb(211, 162, 76)')
  })

  it('drops a style that is not a colour', () => {
    // Scene text ends up inside a video renderer; only the one property is worth allowing.
    const out = sanitiseRichText('<span style="position:fixed;background:url(x)">x</span>')

    expect(out).toBe('<span>x</span>')
  })

  it('removes a script entirely, tag and contents', () => {
    expect(sanitiseRichText('safe<script>alert(1)</script>after')).toBe('safeafter')
  })

  it('removes an event handler by removing the tag that carried it', () => {
    expect(sanitiseRichText('<img src=x onerror="alert(1)">')).toBe('')
  })

  it('removes a link, which a slide has no use for', () => {
    expect(sanitiseRichText('<a href="javascript:alert(1)">click</a>')).toBe('click')
  })

  it('keeps the words when it removes their tags', () => {
    expect(sanitiseRichText('<div><p>Still here</p></div>')).toBe('Still here')
  })

  it('does not let a colon or quotes smuggle something past', () => {
    expect(sanitiseRichText('<span style="color:expression(alert(1))">x</span>')).toBe('<span>x</span>')
  })
})

describe('richTextToPlain', () => {
  it('gives back the words for narration and thumbnails to use', () => {
    expect(richTextToPlain('<strong>Record</strong> a <em>session</em>')).toBe('Record a session')
  })

  it('treats a line break as a space rather than joining words', () => {
    expect(richTextToPlain('one<br>two')).toBe('one two')
  })

  it('reads entities back as the characters they stand for', () => {
    expect(richTextToPlain('Tom &amp; Jerry &lt;live&gt;')).toBe('Tom & Jerry <live>')
  })

  it('leaves plain text exactly as it was', () => {
    expect(richTextToPlain('Just words')).toBe('Just words')
  })
})

describe('plainToRichText', () => {
  it('makes text that was never rich safe to render as markup', () => {
    expect(plainToRichText('5 < 6 & "quoted"')).toBe('5 &lt; 6 &amp; "quoted"')
  })

  it('survives a round trip', () => {
    expect(richTextToPlain(plainToRichText('a < b & c'))).toBe('a < b & c')
  })
})

describe('colours chosen in the editor', () => {
  it('keeps a colour the browser expressed the old way', () => {
    // execCommand answers a colour command with <font color>, not with a span.
    expect(sanitiseRichText('<font color="#d3a24c">brass</font>')).toBe(
      '<span style="color:#d3a24c">brass</span>'
    )
  })

  it('keeps the words when the colour itself is not one', () => {
    expect(sanitiseRichText('<font color="javascript:x">text</font>')).toBe('<span>text</span>')
  })

  it('keeps a colour alongside other formatting', () => {
    expect(sanitiseRichText('Record it <b><font color="#d3a24c">silent</font></b>')).toBe(
      'Record it <b><span style="color:#d3a24c">silent</span></b>'
    )
  })
})
