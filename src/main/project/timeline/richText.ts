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

  return withoutDangerousBlocks.replace(/<\/?([a-z0-9]+)((?:\s[^>]*)?)>/gi, (match, rawTag, rawAttrs) => {
    const tag = String(rawTag).toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) return ''
    if (match.startsWith('</')) return `</${tag}>`
    if (tag === 'br') return '<br>'

    // A span is kept only for the one thing it is allowed to do.
    if (tag === 'span') {
      const colour = String(rawAttrs).match(/color\s*:\s*([^;"']+)/i)?.[1]?.trim()
      return colour && COLOUR.test(colour) ? `<span style="color:${colour}">` : '<span>'
    }

    return `<${tag}>`
  })
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
