import { describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { stillLogo } from './stillLogo'
import { resolveBrowser } from '../capture/resolveBrowser'

/** A typical logo intro: a stroke drawn in by CSS, and a gradient that SMIL slides into place when the site's script says so. */
const ANIMATED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" class="logo play">
<style>.logo path{stroke-dashoffset:var(--o,0)} .logo .bar{--o:100} .logo.play .bar{animation:draw 2s linear 0.3s forwards} @keyframes draw{to{stroke-dashoffset:0}}</style>
<defs><linearGradient id="g" x1="-100" x2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#00e0af"/><stop offset="1" stop-color="#7764fc"/>
<animate attributeName="x1" begin="indefinite" dur="5s" fill="freeze" values="-100; -50; 0"/>
<animate attributeName="x2" begin="indefinite" dur="5s" fill="freeze" values="0; 50; 100"></animate>
<animate attributeName="y1" begin="indefinite" dur="5s" values="0; 9"/>
</linearGradient></defs>
<path class="bar" d="M0 20H100" stroke="#000" stroke-width="10" stroke-dasharray="100"/>
<rect width="100" height="5" fill="url(#g)"><set attributeName="opacity" to="0.5" begin="1s" fill="freeze"/></rect>
</svg>`

describe('a logo that animates', () => {
  it('holds the value each animation would have ended on, and nothing is left to move', () => {
    const still = stillLogo(ANIMATED)

    expect(still).not.toMatch(/<(animate|set)\b/)
    expect(still).toMatch(/<linearGradient id="g" x1="0" x2="100"/)
    expect(still).not.toMatch(/y1="9"/)
    expect(still).toMatch(/<rect width="100" height="5" fill="url\(#g\)" opacity="0.5">/)
    expect(still).toContain('animation-play-state:paused')
  })

  it('looks the same at every moment, finished from the first frame', async () => {
    // The export draws frames out of order in several tabs at once, so a logo that depends on
    // when it is looked at is a different logo in every frame.
    const browser = await chromium.launch({ headless: true, channel: resolveBrowser()?.channel })
    try {
      const page = await browser.newPage({ viewport: { width: 200, height: 80 } })
      const url = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
      const at = async (svg: string, ms: number): Promise<Buffer> => {
        await page.setContent(`<body style="margin:0;background:#fff"><img src="${url(svg)}" width="200"></body>`)
        await page.waitForTimeout(ms)
        return page.screenshot()
      }

      const early = await at(stillLogo(ANIMATED), 50)
      const late = await at(stillLogo(ANIMATED), 2600)

      // The intro as the brand's own page plays it: in the document, its script starting the SMIL.
      await page.setContent(`<body style="margin:0;background:#fff"><div style="width:200px;line-height:0">${ANIMATED}</div></body>`)
      await page.evaluate(() => document.querySelectorAll('animate').forEach((a) => (a as unknown as { beginElement(): void }).beginElement()))
      await page.waitForTimeout(5600)
      const played = await page.screenshot()

      expect(early.equals(late), 'the same early and late').toBe(true)
      expect(early.equals(await at(ANIMATED, 50)), 'unlike the logo as published, mid-intro').toBe(false)
      expect(played.equals(late), 'the same as the intro once played').toBe(true)
    } finally {
      await browser.close()
    }
  }, 60_000)

  it('leaves a logo that does not move exactly as it was', () => {
    const plain = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#e4572e"/></svg>'

    expect(stillLogo(plain)).toBe(plain)
  })
})
