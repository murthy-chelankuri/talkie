import { describe, expect, it, vi } from 'vitest'
import type { NarrationProvider } from '../../agent/narrationProvider'
import type { BrandFacts } from './facts'
import { ruleBasedTheme } from './ruleBasedTheme'
import { proposeTheme } from './proposeTheme'
import { resolveFonts } from './resolveFonts'
import { contrastRatio } from '../contrast'

const facts: BrandFacts = {
  colours: [
    { hex: '#ffffff', weight: 1000, role: 'background' },
    { hex: '#0a2540', weight: 600, role: 'background' },
    { hex: '#635bff', weight: 400, role: 'button' },
    { hex: '#425466', weight: 200, role: 'text' }
  ],
  fonts: [
    { family: 'Sohne', role: 'heading' },
    { family: 'Inter', role: 'body' }
  ],
  sources: ['website'],
  problems: []
}

function provider(answers: string[]): NarrationProvider {
  const complete = vi.fn()
  answers.forEach((answer) => complete.mockResolvedValueOnce(answer))
  return { id: 'claude-cli', label: 'Fake', sendsDataOffMachine: true, isAvailable: async () => ({ available: true }), draft: async () => '', complete }
}

const GOOD = JSON.stringify({
  company: 'Acme',
  tagline: 'Payments infrastructure for the internet',
  variants: {
    brand: { background: '#635bff', heading: '#ffffff', body: '#eef0ff', accent: '#0a2540' },
    light: { background: '#ffffff', heading: '#0a2540', body: '#425466', accent: '#635bff' },
    dark: { background: '#0a2540', heading: '#ffffff', body: '#adbdcc', accent: '#80e9ff' }
  },
  fonts: { heading: 'Sohne', body: 'Inter', headingFallback: 'Inter', bodyFallback: 'Inter' },
  highlight: '#635bff'
})

describe('a theme from rules alone', () => {
  it('puts the brand colour on the brand variant and the page colours on light and dark', () => {
    const { draft } = ruleBasedTheme(facts, 'Acme')

    expect(draft.variants.brand.background).toBe('#635bff')
    expect(draft.variants.light.background).toBe('#ffffff')
    expect(draft.variants.dark.background).toBe('#0a2540')
  })

  it('takes the fonts the site uses', () => {
    const { draft } = ruleBasedTheme(facts, 'Acme')

    expect(draft.fonts.heading.family).toBe('Sohne')
    expect(draft.fonts.body.family).toBe('Inter')
  })

  it('still makes a whole theme from nothing at all', () => {
    const { draft } = ruleBasedTheme({ colours: [], fonts: [], sources: [], problems: [] }, 'Acme')

    expect(draft.name).toBe('Acme')
    expect(contrastRatio(draft.variants.dark.heading, draft.variants.dark.background)).toBeGreaterThan(3)
  })
})

describe('a theme proposed by the model', () => {
  it('uses what the model chose', async () => {
    const { draft, fallbacks } = await proposeTheme(facts, 'calm fintech', 'Acme', provider([GOOD]))

    expect(draft.tagline).toBe('Payments infrastructure for the internet')
    expect(draft.variants.brand.background).toBe('#635bff')
    expect(draft.overlays.highlight).toBe('#635bff')
    expect(fallbacks.heading).toBe('Inter')
  })

  it('finds the JSON even when the model wraps it in prose', async () => {
    const { draft } = await proposeTheme(facts, '', 'Acme', provider([`Here is your theme:\n\`\`\`json\n${GOOD}\n\`\`\``]))

    expect(draft.company).toBe('Acme')
  })

  it('asks once more, saying what was wrong, before giving up on the model', async () => {
    const fake = provider(['{"variants": "nope"}', GOOD])

    const { draft } = await proposeTheme(facts, '', 'Acme', fake)

    expect(draft.variants.light.background).toBe('#ffffff')
    expect((fake.complete as ReturnType<typeof vi.fn>).mock.calls[1][0]).toMatch(/not valid/i)
  })

  it('falls back to the rules after a second bad answer', async () => {
    const { draft, notes } = await proposeTheme(facts, '', 'Acme', provider(['nonsense', 'still nonsense']))

    expect(draft.variants.brand.background).toBe('#635bff')
    expect(notes.join(' ')).toMatch(/rules/i)
  })

  it('goes straight to the rules with a provider that has no model', async () => {
    const template: NarrationProvider = { id: 'template', label: 'Built-in', sendsDataOffMachine: false, isAvailable: async () => ({ available: true }), draft: async () => '' }

    const { draft } = await proposeTheme(facts, '', 'Acme', template)

    expect(draft.variants.brand.background).toBe('#635bff')
  })
})

describe('getting the fonts', () => {
  const css = (family: string): string =>
    `/* latin-ext */\n@font-face { font-family: '${family}'; font-weight: 400; src: url(https://fonts.gstatic.com/ext.woff2) format('woff2'); }\n` +
    `/* latin */\n@font-face { font-family: '${family}'; font-weight: 400; src: url(https://fonts.gstatic.com/${family}-400.woff2) format('woff2'); }\n` +
    `/* latin */\n@font-face { font-family: '${family}'; font-weight: 600; src: url(https://fonts.gstatic.com/${family}-600.woff2) format('woff2'); }\n`

  /** Google Fonts as far as these tests need it: Inter is open, Graphik is not. */
  const google = vi.fn(async (url: string) => {
    if (url.includes('/ofl/inter/METADATA.pb')) return new Response('name: "Inter"')
    if (url.includes('METADATA.pb')) return new Response('', { status: 404 })
    if (url.startsWith('https://fonts.googleapis.com/css2?family=Inter')) return new Response(css('Inter'))
    if (url.startsWith('https://fonts.gstatic.com/Inter-')) return new Response(new Uint8Array([1, 2, 3]))
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch

  it('downloads an open font, its regular and semibold, in the latin set', async () => {
    const { draft } = ruleBasedTheme(facts, 'Acme')
    draft.fonts.heading.family = 'Inter'

    const result = await resolveFonts(draft, {}, google)

    expect(result.draft.fonts.heading).toEqual({ family: 'Inter', source: 'google', files: ['fonts/Inter-400.woff2', 'fonts/Inter-600.woff2'] })
    expect(result.files.map((file) => file.fileName)).toEqual(['fonts/Inter-400.woff2', 'fonts/Inter-600.woff2'])
  })

  it('uses the open stand-in for a commercial font, and says which', async () => {
    const { draft } = ruleBasedTheme(facts, 'Acme')
    draft.fonts.heading.family = 'Graphik'

    const result = await resolveFonts(draft, { heading: 'Inter' }, google)

    expect(result.draft.fonts.heading.family).toBe('Inter')
    expect(result.notes.join(' ')).toMatch(/Graphik.*Inter/)
  })

  it('falls back to Talkie’s own type when nothing can be fetched', async () => {
    const { draft } = ruleBasedTheme(facts, 'Acme')
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    const result = await resolveFonts(draft, {}, offline)

    expect(result.draft.fonts.body).toEqual({ family: 'Geist Variable', source: 'builtin', files: [] })
    expect(result.notes.join(' ')).toMatch(/could not/i)
  })
})
