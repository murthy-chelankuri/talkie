import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { createRequire } from 'module'
import { chromium } from 'playwright'
import { resolveBrowser } from '../capture/resolveBrowser'
import { diagramBackground, mermaidConfigFor, normaliseSvg } from './mermaidTheme'
import { fontFaceCss, type RenderTheme } from '../../composition/renderTheme'
import type { VariantId } from '../themes/schema'

const require = createRequire(import.meta.url)

/**
 * Draw a mermaid diagram without a Talkie window open.
 *
 * Mermaid measures text to lay a diagram out, so it needs a browser — which is why diagrams
 * were drawn in the renderer and an agent could only write the source and wait for the app to
 * catch up. Its diagram sat on the timeline showing nothing, which reads as broken rather than
 * pending.
 *
 * There is a browser here: the same Playwright Chromium that records demos. Headless, empty,
 * open for as long as one render takes. That is a heavy way to draw a picture, and it is still
 * cheaper than the alternative — a second diagram library whose output would not match the one
 * the window draws with.
 *
 * Matching is the whole point, so the configuration and the font both come from the same place
 * the app's own renderer uses. Without the font it would lay out against whatever Chromium
 * falls back to and every box would be a different size.
 */

/** Long enough for a cold browser start and a large graph; short enough to give up on. */
const TIMEOUT_MS = 45_000

let fontCss: string | null = null

/**
 * The app's typeface, as a data URL.
 *
 * A headless browser has no fonts installed beyond the system's, and mermaid sizes every box
 * to the text inside it — so drawing without this produces a diagram laid out to a different
 * font from the one it is displayed in.
 */
function geistFontCss(): string {
  if (fontCss !== null) return fontCss

  try {
    const file = require.resolve('@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')
    const base64 = readFileSync(file).toString('base64')
    fontCss = `@font-face{font-family:'Geist Variable';font-style:normal;font-display:block;font-weight:100 900;src:url(data:font/woff2;base64,${base64}) format('woff2-variations')}`
  } catch {
    // Without it the diagram still draws, laid out against a fallback face. Worse than
    // matching, better than not drawing at all.
    fontCss = ''
  }
  return fontCss
}

/**
 * A made-up origin the page is served from.
 *
 * Nothing is listening on it: every request is answered from `node_modules` by a route on the
 * page itself. It exists because mermaid's published module imports its own chunks by relative
 * path, and a relative path needs somewhere to be relative to — which a blob has not got and
 * `file://` is not allowed to be.
 */
const ORIGIN = 'http://mermaid.talkie.invalid'

export async function renderMermaidHeadless(
  source: string,
  theme: RenderTheme | null = null,
  variant: VariantId = 'dark'
): Promise<string> {
  const trimmed = source.trim()
  if (!trimmed) throw new Error('There is no diagram to draw yet.')

  const entry = require.resolve('mermaid/dist/mermaid.esm.min.mjs')
  const distDir = dirname(entry)

  const choice = resolveBrowser()
  const browser = await chromium.launch({ headless: true, channel: choice?.channel })

  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(TIMEOUT_MS)

    await page.route(`${ORIGIN}/**`, async (route, request) => {
      const path = new URL(request.url()).pathname

      if (path === '/') {
        return route.fulfill({
          contentType: 'text/html',
          body:
            // The theme's own faces beside Talkie's: mermaid sizes each box to its text, so it has to
            // measure in the font the diagram will be shown in.
            `<!doctype html><style>${geistFontCss()}${theme ? fontFaceCss(theme) : ''}</style><body></body>` +
            `<script type="module">import m from './mermaid.esm.min.mjs'; window.__mermaid = m</script>`
        })
      }

      // Served straight out of the package, so a request that climbs out of it is not a
      // request mermaid made.
      const file = resolve(distDir, `.${path}`)
      if (!file.startsWith(`${distDir}/`)) return route.abort()

      try {
        return await route.fulfill({ contentType: 'text/javascript', body: readFileSync(file) })
      } catch {
        return route.fulfill({ status: 404, body: '' })
      }
    })

    await page.goto(`${ORIGIN}/`)
    await page.waitForFunction(() => Boolean((window as unknown as { __mermaid?: unknown }).__mermaid))
    await page.evaluate(() => document.fonts.ready)

    const svg = await page.evaluate(
      async ({ config, diagram }) => {
        const mermaid = (window as unknown as { __mermaid: MermaidApi }).__mermaid
        mermaid.initialize(config)
        // A syntax error throws with a readable message, which is the author's to fix.
        const { svg } = await mermaid.render('talkie-diagram', diagram)
        return svg
      },
      { config: mermaidConfigFor(theme, variant), diagram: trimmed }
    )

    return normaliseSvg(svg, diagramBackground(theme, variant))
  } finally {
    await browser.close()
  }
}

/** Only the two calls used here; the published types are for a browser build. */
interface MermaidApi {
  initialize: (config: unknown) => void
  render: (id: string, source: string) => Promise<{ svg: string }>
}
