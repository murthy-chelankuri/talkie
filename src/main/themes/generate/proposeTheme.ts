import { z } from 'zod'
import type { NarrationProvider } from '../../agent/narrationProvider'
import { HexColourSchema, ThemeDraftSchema, VariantSchema } from '../schema'
import type { BrandFacts } from './facts'
import { ruleBasedTheme, type Proposal } from './ruleBasedTheme'

/** What the model is asked to return: choices only, nothing it could not know. */
const AnswerSchema = z.object({
  company: z.string(),
  tagline: z.string().default(''),
  variants: z.object({ brand: VariantSchema, light: VariantSchema, dark: VariantSchema }),
  fonts: z.object({
    heading: z.string().min(1),
    body: z.string().min(1),
    headingFallback: z.string().optional(),
    bodyFallback: z.string().optional()
  }),
  highlight: HexColourSchema
})

function describeFacts(facts: BrandFacts, description: string): string {
  const total = facts.colours.reduce((sum, c) => sum + c.weight, 0) || 1
  return [
    facts.colours.length > 0
      ? `Colours found, with how much of what was read each covers:\n${facts.colours
          .slice(0, 12)
          .map((c) => `  ${c.hex}  ${Math.round((c.weight / total) * 100)}%  (${c.role})`)
          .join('\n')}`
      : 'No colours could be read.',
    facts.fonts.length > 0
      ? `Fonts found:\n${facts.fonts.map((f) => `  ${f.family} (${f.role})`).join('\n')}`
      : 'No fonts could be read.',
    description.trim() ? `How the person describes the company:\n  ${description.trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

function prompt(facts: BrandFacts, description: string, name: string): string {
  return [
    `Design a video theme for "${name}" from what was read off its brand.`,
    '',
    describeFacts(facts, description),
    '',
    'The theme has three variants a slide can be drawn in: "brand" (a background in the main',
    'brand colour), "light" and "dark". Each has background, heading, body and accent colours,',
    'as #rrggbb. Use the brand\'s real colours where they were found; invent only what is missing.',
    'Text must be easy to read on its background. The accent is for small marks, not text.',
    '',
    'Fonts: name the heading and body families the brand uses. If either is not a free Google',
    'Font, give the closest free Google Font as headingFallback / bodyFallback.',
    '',
    'tagline: one short line the company would say about itself, or "" if nothing suggests one.',
    'highlight: the colour to ring each click in a screen recording — usually the brand colour.',
    '',
    'Answer with JSON only, in exactly this shape:',
    '{"company": "", "tagline": "", "variants": {"brand": {"background": "#", "heading": "#",',
    '"body": "#", "accent": "#"}, "light": {…}, "dark": {…}}, "fonts": {"heading": "",',
    '"body": "", "headingFallback": "", "bodyFallback": ""}, "highlight": "#"}'
  ].join('\n')
}

/** The first {…} in an answer — models wrap JSON in prose and fences however they are asked. */
function firstObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('The answer had no JSON object in it.')
  return JSON.parse(text.slice(start, end + 1))
}

/**
 * A theme chosen by the configured narration provider from what was read.
 *
 * Its answer is checked against a schema and asked for once more with the errors if it fails;
 * after that, and for the built-in provider that has no model, the rules choose. A draft always
 * comes back, so creating a theme never ends in nothing.
 */
export async function proposeTheme(
  facts: BrandFacts,
  description: string,
  name: string,
  provider: NarrationProvider
): Promise<Proposal> {
  const fallback = (why: string): Proposal => {
    const ruled = ruleBasedTheme(facts, name)
    return { ...ruled, notes: [why] }
  }
  if (!provider.complete) return ruleBasedTheme(facts, name)

  let ask = prompt(facts, description, name)
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: string
    try {
      reply = await provider.complete(ask)
    } catch (err) {
      return fallback(`The AI could not be reached (${err instanceof Error ? err.message : String(err)}), so the colours were chosen by rule.`)
    }

    try {
      const answer = AnswerSchema.parse(firstObject(reply))
      const draft = ThemeDraftSchema.parse({
        name,
        company: answer.company || name,
        tagline: answer.tagline,
        variants: answer.variants,
        fonts: {
          heading: { family: answer.fonts.heading, source: 'google' },
          body: { family: answer.fonts.body, source: 'google' }
        },
        overlays: { highlight: answer.highlight }
      })
      return { draft, fallbacks: { heading: answer.fonts.headingFallback, body: answer.fonts.bodyFallback }, notes: [] }
    } catch (err) {
      const problem = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err)
      ask = `${prompt(facts, description, name)}\n\nYour last answer was not valid (${problem}). Reply with the JSON only.`
    }
  }
  return fallback('The AI’s answer could not be used twice running, so the colours were chosen by rules.')
}
