/**
 * The small amount of HTML a scene is allowed to contain.
 *
 * Scene text is written in the app and then rendered into a video by a headless browser, so
 * whatever is stored is eventually put into a page with innerHTML. Keeping the allowed set tiny
 * and rebuilding the markup from scratch — rather than trying to strip the bad parts out of
 * whatever arrives — means nothing unexpected can reach either the preview or the renderer.
 */
const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'span'])

/** Only a colour, and only one that looks like a colour. */
const COLOUR = /^#[0-9a-f]{3,8}$|^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i

export function sanitiseRichText(html: string): string {
  // Browsers still answer a colour command with <font color>, which is not in the allowed set
  // and would otherwise be dropped along with the colour someone deliberately chose.
  const withFontsAsSpans = html
    .replace(/<font\b[^>]*\bcolor\s*=\s*["']?([^"'\s>]+)["']?[^>]*>/gi, (_match, colour) =>
      COLOUR.test(String(colour)) ? `<span style="color:${colour}">` : '<span>'
    )
    .replace(/<\/font>/gi, '</span>')

  const withoutDangerousBlocks = withFontsAsSpans
    .replace(/<(script|style|iframe|object|embed|svg|math)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|svg|math)\b[^>]*\/?>/gi, '')

  /**
   * Anything a browser would read as a tag: a name, then everything up to the closing bracket.
   *
   * Requiring whitespace before the attributes is what an earlier version did, and HTML does not
   * — `<b/onmouseover=alert(1)>` separates them with a slash, matched nothing, and was therefore
   * copied through untouched into a live event handler. Nothing `<`-led may leave here without
   * having been rebuilt.
   *
   * Quoted attribute values are stepped over whole, because a `>` inside one does not end the
   * tag. Stopping at it instead split `<span title="a>b">` down the middle and spilled the
   * remainder into the text — harmless, since text is not markup, but it corrupted the words.
   */
  const TAG = /<\/?([a-z0-9]+)((?:"[^"]*"|'[^']*'|[^>])*)>/gi

  let out = ''
  let readTo = 0
  let match: RegExpExecArray | null

  while ((match = TAG.exec(withoutDangerousBlocks)) !== null) {
    out += escapeStrayBrackets(withoutDangerousBlocks.slice(readTo, match.index))
    out += rebuildTag(match[0], match[1], match[2])
    readTo = match.index + match[0].length
  }

  return out + escapeStrayBrackets(withoutDangerousBlocks.slice(readTo))
}

/** One allowed tag, written from its name alone — every attribute is discarded unread. */
function rebuildTag(whole: string, rawTag: string, rawAttrs: string): string {
  const tag = rawTag.toLowerCase()
  if (!ALLOWED_TAGS.has(tag)) return ''
  if (whole.startsWith('</')) return `</${tag}>`
  if (tag === 'br') return '<br>'

  // A span is kept only for the one thing it is allowed to do.
  if (tag === 'span') {
    const colour = rawAttrs.match(/color\s*:\s*([^;"']+)/i)?.[1]?.trim()
    return colour && COLOUR.test(colour) ? `<span style="color:${colour}">` : '<span>'
  }

  return `<${tag}>`
}

/**
 * A `<` that opened nothing, left where text goes.
 *
 * An unterminated tag is dropped at the end of input by the HTML parser rather than executed, so
 * this is not the thing standing between the app and an injection — but text is where it belongs,
 * and escaping it means no path through here ends in a bracket the parser gets to interpret.
 */
function escapeStrayBrackets(text: string): string {
  return text.replace(/</g, '&lt;')
}

/**
 * The words without any of the markup, for everything that needs text rather than a rendering:
 * the narration prompt, the clip thumbnail, and anything that has to measure or search it.
 */
export function richTextToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Plain text turned into markup safely, for text that was never rich to begin with. */
export function plainToRichText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
