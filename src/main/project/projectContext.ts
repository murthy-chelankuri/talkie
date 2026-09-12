import { z } from 'zod'

/**
 * What the model is missing when it writes about a demo.
 *
 * Narration is drafted a clip at a time from an action log and a few frames, which is enough to
 * say what moved and nothing about what it was. So it writes "you click the menu" where a
 * presenter would say "you open the campaign builder" — not because it chose to be vague, but
 * because nobody told it what the product is called or what it does.
 *
 * These four answers are the ones that change the writing, and they are asked once per demo
 * rather than per clip: a demo has one subject, one audience and one voice, and fifty-three
 * clips that should sound like they came from the same person.
 */
export const ProjectContextSchema = z.object({
  /** The product, what it does, and the words it uses for its own parts. */
  background: z.string().default(''),
  /** Who is watching, which decides how much is assumed and how much explained. */
  audience: z.string().default(''),
  /** How it should sound. */
  tone: z.string().default(''),
  /** Things never to say. Rules rather than flavour, so they are kept apart. */
  neverSay: z.array(z.string()).default([])
})

export type ProjectContext = z.infer<typeof ProjectContextSchema>

export const EMPTY_CONTEXT: ProjectContext = ProjectContextSchema.parse({})

export function hasProjectContext(context: ProjectContext | undefined): boolean {
  if (!context) return false
  return Boolean(
    context.background.trim() ||
      context.audience.trim() ||
      context.tone.trim() ||
      context.neverSay.some((rule) => rule.trim())
  )
}

/**
 * The context as the model reads it, for every prompt that writes something for this demo.
 *
 * Shared by narration, slides and rewriting rather than written out three times, because the
 * point is that they agree with each other — a slide that calls it a workspace and narration
 * that calls it a project is exactly what this is for.
 *
 * Returns nothing at all when nothing has been said. An empty heading reads as an instruction
 * with no content, which a model will try to satisfy anyway.
 */
export function describeProjectContext(context: ProjectContext | undefined): string[] {
  if (!hasProjectContext(context)) return []
  const { background, audience, tone, neverSay } = context as ProjectContext

  const lines = ['About this demo, from the person making it:']

  if (background.trim()) lines.push('', background.trim())
  if (audience.trim()) lines.push('', `Who is watching: ${audience.trim()}`)
  if (tone.trim()) lines.push('', `How it should sound: ${tone.trim()}`)

  const rules = neverSay.map((rule) => rule.trim()).filter(Boolean)
  if (rules.length > 0) {
    lines.push(
      '',
      'Never say any of these, in any form — they are not preferences:',
      ...rules.map((rule) => `  - ${rule}`)
    )
  }

  lines.push(
    '',
    'Use the names and words above exactly as they are written. Where this conflicts with what',
    'you can see on screen, what is written here wins.',
    ''
  )

  return lines
}

/**
 * Which forbidden terms a draft actually contains.
 *
 * A prompt is a request, not a guarantee — a model can be told not to mention pricing and
 * mention it anyway. Checking afterwards is what makes the rule something the user can rely on
 * rather than something they have to proofread for across fifty clips.
 *
 * Matched on word boundaries so "beta" does not fire on "betamax", and case-insensitively
 * because a rule is about the word, not its capitals.
 */
export function findForbiddenTerms(text: string, neverSay: string[]): string[] {
  const found: string[] = []

  for (const rule of neverSay) {
    const term = rule.trim()
    if (!term) continue

    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeForRegExp(term)}($|[^\\p{L}\\p{N}])`, 'iu')
    if (pattern.test(text)) found.push(term)
  }

  return found
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
