import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { readWebsite } from './readWebsite'
import { readLogo } from './readLogo'
import { readBrandGuide } from './readBrandGuide'
import { mergeFacts } from './facts'
import { bandedPng, textPdf } from './testImages'

let dir: string
const page = (name: string, html: string): string => {
  writeFileSync(join(dir, name), html)
  return pathToFileURL(join(dir, name)).href
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'talkie-read-brand-'))
  writeFileSync(join(dir, 'favicon.png'), bandedPng(['#e4572e']))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const BRAND_SITE = `<!doctype html><html><head><title>Acme</title>
<style>
  body { margin: 0; background: #ffffff; color: #0a2540; font-family: Inter, sans-serif; }
  header { display: flex; justify-content: space-between; padding: 16px 40px; }
  nav a { color: #635bff; margin-left: 24px; }
  h1 { font-family: "Sohne", system-ui, sans-serif; font-size: 64px; }
  .hero { background: #0a2540; color: #ffffff; padding: 120px 40px; height: 500px; }
  button { background: #635bff; color: #fff; border: 0; padding: 14px 28px; font-size: 18px; }
</style></head><body>
<header><a href="/" class="logo"><svg aria-label="Acme logo" width="120" height="32" viewBox="0 0 120 32"><rect width="120" height="32" fill="#635bff"/></svg></a>
<nav><a href="/pricing">Pricing</a><a href="/docs">Docs</a></nav></header>
<section class="hero"><h1>Payments infrastructure for the internet</h1><p>Millions of companies use Acme.</p><button>Start now</button></section>
</body></html>`

describe('reading a brand off its website', () => {
  it('finds its colours, with the ones covering most of the page first', async () => {
    const facts = await readWebsite(page('brand.html', BRAND_SITE), { allowFileUrls: true })
    const hexes = facts.colours.map((colour) => colour.hex)

    expect(hexes).toContain('#635bff')
    expect(hexes).toContain('#0a2540')
    expect(facts.colours.find((c) => c.hex === '#635bff')?.role).toMatch(/button|link|logo/)
  }, 60_000)

  it('names its fonts, leaving out the generic fallbacks', async () => {
    const facts = await readWebsite(page('brand.html', BRAND_SITE), { allowFileUrls: true })

    expect(facts.fonts).toContainEqual({ family: 'Sohne', role: 'heading' })
    expect(facts.fonts).toContainEqual({ family: 'Inter', role: 'body' })
    expect(facts.fonts.map((f) => f.family)).not.toContain('sans-serif')
  }, 60_000)

  it('takes the logo from the header', async () => {
    const facts = await readWebsite(page('brand.html', BRAND_SITE), { allowFileUrls: true })

    expect(facts.logo?.fileName).toBe('logo.svg')
    expect(facts.logo?.bytes.toString()).toContain('#635bff')
  }, 60_000)

  it('falls back to the site’s icon when the header has no logo', async () => {
    const url = page('icon.html', `<!doctype html><html><head><link rel="icon" href="favicon.png"></head><body><h1>Hello</h1></body></html>`)

    const facts = await readWebsite(url, { allowFileUrls: true })

    expect(facts.logo?.fileName).toBe('logo.png')
  }, 60_000)

  it('says when the site asks for a sign-in, rather than taking the login screen for the brand', async () => {
    const url = page('signin.html', `<!doctype html><html><head><title>Sign in</title></head><body><h1>Sign in</h1><form><input type="email" name="email"><input type="password" name="password" autocomplete="current-password"><button>Sign in</button></form></body></html>`)

    const facts = await readWebsite(url, { allowFileUrls: true })

    expect(facts.problems.join(' ')).toMatch(/sign-in/i)
  }, 60_000)

  it('will only read a web address', async () => {
    await expect(readWebsite('file:///etc/passwd')).rejects.toThrow(/web address/)
    await expect(readWebsite('javascript:alert(1)')).rejects.toThrow(/web address/)
  })
})

describe('reading a brand off its logo', () => {
  it('finds the colours it is made of, the larger first', async () => {
    const facts = await readLogo(bandedPng(['#635bff', '#635bff', '#0a2540']), 'logo.png')

    expect(facts.colours.map((c) => c.hex).slice(0, 2)).toEqual(['#635bff', '#0a2540'])
    expect(facts.logo?.fileName).toBe('logo.png')
  }, 60_000)
})

describe('reading a brand guide', () => {
  it('finds the hex codes and the typeface it names', async () => {
    const pdf = textPdf(['Acme brand guidelines', 'Primary colour: #635BFF', 'Navy #0A2540', 'Typeface: Inter'])

    const facts = await readBrandGuide(pdf)

    expect(facts.colours.map((c) => c.hex)).toEqual(['#635bff', '#0a2540'])
    expect(facts.fonts).toContainEqual({ family: 'Inter', role: 'document' })
  }, 60_000)
})

describe('putting what was read together', () => {
  it('adds up the same colour found in two places', () => {
    const merged = mergeFacts(
      { colours: [{ hex: '#635bff', weight: 2, role: 'logo' }], fonts: [], sources: ['logo'], problems: [] },
      { colours: [{ hex: '#635bff', weight: 3, role: 'button' }], fonts: [{ family: 'Inter', role: 'body' }], sources: ['website'], problems: ['x'] }
    )

    expect(merged.colours).toEqual([{ hex: '#635bff', weight: 5, role: 'button' }])
    expect(merged.sources).toEqual(['logo', 'website'])
    expect(merged.problems).toEqual(['x'])
  })
})
