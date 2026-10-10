import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { chromium, type APIRequestContext } from 'playwright'
import { resolveBrowser } from '../../capture/resolveBrowser'
import { authWall } from '../../capture/authWall'
import type { CapturedField } from '../../capture/redact'
import { MAX_LOGO_BYTES } from '../themeApi'
import { cssColourToHex, type BrandFacts, type ColourRole } from './facts'

/** Long enough for a heavy marketing page; short enough to give up on and say so. */
const TIMEOUT_MS = 30_000

/** Font names that say nothing about a brand — the fallbacks at the end of every stack. */
const GENERIC_FONTS = new Set([
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif',
  'ui-monospace', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'helvetica', 'helvetica neue',
  'arial', 'roboto', 'apple color emoji', 'segoe ui emoji', 'times', 'times new roman'
])

interface PageReading {
  colours: { value: string; weight: number; role: ColourRole }[]
  headingFonts: string[]
  bodyFonts: string[]
  logo: { kind: 'svg'; markup: string } | { kind: 'url'; url: string } | null
  wall: { title: string; heading: string; text: string; fields: CapturedField[]; links: number }
}

/**
 * Run in the page. Reads what is on screen as the browser computed it — the real colours and
 * fonts, after every stylesheet — weighted by how much of the page each covers. Reads only;
 * nothing here clicks, types or follows anything.
 */
function readPage(): PageReading {
  const colours: PageReading['colours'] = []
  const viewportArea = window.innerWidth * window.innerHeight
  const area = (el: Element): number => {
    const rect = el.getBoundingClientRect()
    return Math.min(rect.width * rect.height, viewportArea * 2)
  }

  const bodyStyle = getComputedStyle(document.body)
  colours.push({ value: bodyStyle.backgroundColor, weight: viewportArea, role: 'background' })
  colours.push({ value: bodyStyle.color, weight: viewportArea / 4, role: 'text' })

  for (const el of Array.from(document.querySelectorAll('header, nav, footer, main, section, div, aside'))) {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    colours.push({ value: style.backgroundColor, weight: area(el) / 2, role: 'background' })
  }
  for (const el of Array.from(document.querySelectorAll('button, [role="button"], a[class*="btn"], a[class*="button"]'))) {
    const style = getComputedStyle(el)
    colours.push({ value: style.backgroundColor, weight: area(el) * 8, role: 'button' })
  }
  for (const el of Array.from(document.querySelectorAll('a'))) {
    colours.push({ value: getComputedStyle(el).color, weight: (el.textContent ?? '').length * 40, role: 'link' })
  }
  for (const el of Array.from(document.querySelectorAll('h1, h2, h3'))) {
    colours.push({ value: getComputedStyle(el).color, weight: area(el) / 4, role: 'heading' })
  }

  const families = (selector: string): string[] =>
    Array.from(document.querySelectorAll(selector))
      .slice(0, 12)
      .map((el) => getComputedStyle(el).fontFamily)

  // The logo: something in the header that says it is one, or the link home that most sites wrap
  // it in. Then the icons a site declares for itself.
  const header = document.querySelector('header, nav, [role="banner"]') ?? document.body
  const says = (el: Element): boolean =>
    /logo|brand/i.test(
      [el.getAttribute('aria-label'), el.getAttribute('alt'), el.getAttribute('class'), el.id, el.getAttribute('src')].join(' ')
    )
  const homeLink = Array.from(header.querySelectorAll('a')).find((a) => ['/', './', 'index.html'].includes(a.getAttribute('href') ?? ''))
  const marked =
    Array.from(header.querySelectorAll('svg, img')).find((el) => says(el) || (el.parentElement && says(el.parentElement))) ??
    homeLink?.querySelector('svg, img') ??
    null

  let logo: PageReading['logo'] = null
  if (marked?.tagName.toLowerCase() === 'svg') {
    const svg = marked.cloneNode(true) as SVGElement
    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    logo = { kind: 'svg', markup: svg.outerHTML }
  } else if (marked) {
    logo = { kind: 'url', url: (marked as HTMLImageElement).currentSrc || (marked as HTMLImageElement).src }
  } else {
    const icon =
      document.querySelector<HTMLLinkElement>('link[rel~="apple-touch-icon"]') ??
      document.querySelector<HTMLLinkElement>('link[rel~="icon"]') ??
      null
    const og = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')
    if (icon?.href) logo = { kind: 'url', url: icon.href }
    else if (og?.content) logo = { kind: 'url', url: new URL(og.content, location.href).href }
  }

  return {
    colours,
    headingFonts: families('h1, h2'),
    bodyFonts: [bodyStyle.fontFamily, ...families('p')],
    logo,
    wall: {
      title: document.title,
      heading: document.querySelector('h1')?.textContent ?? '',
      text: (document.body.innerText ?? '').slice(0, 1200),
      fields: Array.from(document.querySelectorAll('input')).map((input) => ({
        type: input.type,
        name: input.name,
        id: input.id,
        autocomplete: input.autocomplete
      })),
      links: document.querySelectorAll('a[href]').length
    }
  }
}

function firstNamedFamily(stacks: string[]): string | null {
  for (const stack of stacks) {
    for (const part of stack.split(',')) {
      const family = part.trim().replace(/^["']|["']$/g, '')
      if (family && !GENERIC_FONTS.has(family.toLowerCase())) return family
    }
  }
  return null
}

const IMAGE_TYPES: Record<string, string> = {
  'image/svg+xml': '.svg',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
}

/** By what the server says it is, or failing that by its name. An .ico is not one of these. */
function extensionFor(url: string, contentType: string): string | undefined {
  const declared = IMAGE_TYPES[contentType.split(';')[0].trim().toLowerCase()]
  if (declared) return declared
  const named = /\.(svg|png|jpe?g|webp)(?:[?#]|$)/i.exec(url)?.[1].toLowerCase()
  return named ? `.${named === 'jpeg' ? 'jpg' : named}` : undefined
}

/** The logo's bytes, if it is a picture Talkie can draw and small enough to carry. */
async function downloadLogo(
  request: APIRequestContext,
  url: string,
  allowFileUrls: boolean
): Promise<BrandFacts['logo'] | undefined> {
  try {
    if (url.startsWith('file:')) {
      if (!allowFileUrls) return undefined
      const extension = extensionFor(url, '')
      const bytes = readFileSync(fileURLToPath(url))
      return extension && bytes.length <= MAX_LOGO_BYTES ? { bytes, fileName: `logo${extension}` } : undefined
    }
    const response = await request.get(url, { timeout: 10_000, maxRedirects: 3 })
    const extension = extensionFor(url, response.headers()['content-type'] ?? '')
    const bytes = await response.body()
    return response.ok() && extension && bytes.length <= MAX_LOGO_BYTES ? { bytes, fileName: `logo${extension}` } : undefined
  } catch {
    return undefined
  }
}

/**
 * Read a company's colours, fonts and logo off its website.
 *
 * In the headless browser recordings already use. It loads the one page and stays there: any
 * navigation after the first is refused, downloads are refused, and nothing is clicked or typed.
 * This is someone else's live site, read on the user's behalf, and looking is all it is for.
 */
export async function readWebsite(url: string, opts: { allowFileUrls?: boolean } = {}): Promise<BrandFacts> {
  let parsed: URL
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`)
  } catch {
    throw new Error(`"${url}" is not a web address.`)
  }
  const allowed = parsed.protocol === 'https:' || parsed.protocol === 'http:' || (opts.allowFileUrls && parsed.protocol === 'file:')
  if (!allowed) throw new Error(`"${url}" is not a web address.`)

  const host = parsed.protocol === 'file:' ? 'the page' : parsed.hostname
  const facts: BrandFacts = { colours: [], fonts: [], sources: ['website'], problems: [] }

  const browser = await chromium.launch({ headless: true, channel: resolveBrowser()?.channel })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: false })
    const page = await context.newPage()
    page.setDefaultTimeout(TIMEOUT_MS)

    let landed = false
    await page.route('**/*', (route, request) => {
      if (landed && request.isNavigationRequest() && request.frame() === page.mainFrame()) return route.abort()
      return route.continue()
    })

    try {
      await page.goto(parsed.href, { waitUntil: 'load', timeout: TIMEOUT_MS })
    } catch (err) {
      facts.problems.push(`Could not open ${host}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
      return facts
    }
    landed = true
    // Settled, if it will: plenty of sites fetch their styles late. Not waited on forever.
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined)

    const reading = await page.evaluate(readPage)

    if (authWall({ url: parsed.href, title: reading.wall.title, heading: reading.wall.heading, text: reading.wall.text, fields: reading.wall.fields, candidates: Array(reading.wall.links) })) {
      facts.problems.push(`${host} asked for a sign-in, so its own pages could not be read.`)
    }

    const weights = new Map<string, { weight: number; role: ColourRole; heaviest: number }>()
    for (const { value, weight, role } of reading.colours) {
      const hex = cssColourToHex(value)
      if (!hex || weight <= 0) continue
      const seen = weights.get(hex)
      if (!seen) weights.set(hex, { weight, role, heaviest: weight })
      else {
        seen.weight += weight
        if (weight > seen.heaviest) Object.assign(seen, { role, heaviest: weight })
      }
    }
    facts.colours = [...weights.entries()]
      .map(([hex, { weight, role }]) => ({ hex, weight, role }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 12)

    const heading = firstNamedFamily(reading.headingFonts)
    const body = firstNamedFamily(reading.bodyFonts)
    if (heading) facts.fonts.push({ family: heading, role: 'heading' })
    if (body) facts.fonts.push({ family: body, role: 'body' })

    if (reading.logo?.kind === 'svg') {
      facts.logo = { bytes: Buffer.from(reading.logo.markup), fileName: 'logo.svg' }
    } else if (reading.logo?.kind === 'url') {
      const logo = await downloadLogo(context.request, reading.logo.url, Boolean(opts.allowFileUrls))
      if (logo) facts.logo = logo
      else facts.problems.push(`Found ${host}'s logo but could not use it.`)
    }
    return facts
  } finally {
    await browser.close()
  }
}
