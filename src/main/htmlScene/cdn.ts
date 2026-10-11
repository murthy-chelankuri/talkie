/**
 * Pages written for the web load their libraries from CDNs, and a scene cannot reach the network.
 * Where the library is one Talkie ships, the tag is pointed at Talkie's copy instead; anything else
 * remote is named, so whoever imported the page knows what will not load.
 */
export const BUNDLED_LIBRARIES = [
  { name: 'anime', file: 'anime.min.js', pattern: /anime(?:js)?[@/].*\.js$|\/anime(?:\.min)?\.js$/i },
  { name: 'd3', file: 'd3.min.js', pattern: /\/d3(?:@[\w.-]+)?\/.*\.js$|d3js\.org\/d3(?:\.v\d+)?(?:\.min)?\.js$|\/d3(?:\.min)?\.js$/i },
  { name: 'lottie', file: 'lottie.min.js', pattern: /lottie(?:-web)?[@/].*lottie(?:_\w+)?(?:\.min)?\.js$|\/lottie(?:\.min)?\.js$/i }
] as const

/** Tags whose src or href the browser fetches. A link (`<a>`) is followed, not loaded, so it is not here. */
const LOADING_TAG = /<(script|link|img|source|video|audio|iframe|embed|track|image|use)\b[^>]*>/gi
const REMOTE_ATTRIBUTE = /\b(src|href|xlink:href|poster)\s*=\s*(["'])((?:https?:)?\/\/[^"']+)\2/gi
const REMOTE_IN_CSS = /(?:@import\s+(?:url\()?|url\()\s*["']?((?:https?:)?\/\/[^"')\s]+)/gi

export function rewriteBundledCdns(html: string, libraryBase: string): { html: string; remote: string[] } {
  const remote: string[] = []
  const rewritten = html.replace(LOADING_TAG, (tag, name: string) =>
    tag.replace(REMOTE_ATTRIBUTE, (whole, attribute: string, quote: string, url: string) => {
      const library = name.toLowerCase() === 'script' && attribute.toLowerCase() === 'src'
        ? BUNDLED_LIBRARIES.find((lib) => lib.pattern.test(url))
        : undefined
      if (library) return `${attribute}=${quote}${libraryBase}${library.file}${quote}`
      remote.push(url)
      return whole
    })
  )
  for (const match of rewritten.matchAll(REMOTE_IN_CSS)) remote.push(match[1])
  return { html: rewritten, remote }
}
