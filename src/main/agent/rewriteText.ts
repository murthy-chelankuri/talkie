import { homedir } from 'os'
import { readSettings } from '../settings/settingsStore'
import { narrationProvider } from './providerRegistry'
import { cleanDraft, targetWordCount } from './narrationProvider'

export const REWRITE_STYLES = ['rephrase', 'proofread', 'concise', 'fit'] as const
export type RewriteStyle = (typeof REWRITE_STYLES)[number]

export interface RewriteRequest {
  text: string
  style: RewriteStyle
  /** How long the clip runs, for the one rewrite that has a length to hit. */
  seconds?: number
}

export const REWRITE_LABELS: Record<RewriteStyle, string> = {
  rephrase: 'Rephrase',
  proofread: 'Proofread',
  concise: 'Make concise',
  fit: 'Fit the clip'
}

/**
 * Rewriting narration with whichever model is already set up.
 *
 * These are the same four things Apple's Writing Tools offers, with one it cannot: narration is
 * spoken over a clip of a known length, so "fit the clip" has a real target to write to. The
 * others are here because a rewrite that leaves the tone somewhere else is not much use — every
 * prompt says this is spoken aloud, which is the fact that decides the answer.
 */
export function buildRewritePrompt({ text, style, seconds }: RewriteRequest): string {
  const shared = [
    'You are editing one line of narration that will be read aloud over a clip in a product demo.',
    'It is speech, not prose: it has to sound like a person talking to someone watching.',
    ''
  ]

  const instruction: Record<RewriteStyle, string[]> = {
    rephrase: [
      'Say the same thing a different way.',
      'Keep every fact and the same meaning. Do not make it longer.'
    ],
    proofread: [
      'Fix spelling, grammar and punctuation, and nothing else.',
      'Keep the wording, the tone and the length as they are. If nothing is wrong, return it unchanged.'
    ],
    concise: [
      'Say it in fewer words.',
      'Keep every fact. Cut hedging and repetition rather than detail.'
    ],
    fit: seconds
      ? [
          `This has to be spoken in about ${seconds.toFixed(1)} seconds, which is roughly`,
          `${targetWordCount(seconds)} words. Rewrite it to that length.`,
          'Keep what matters and drop what does not. Going over means the voice runs past the clip.'
        ]
      : ['Say it in fewer words, keeping every fact.']
  }

  return [
    ...shared,
    ...instruction[style],
    '',
    'Reply with the rewritten line and nothing else — no quotes, no preamble, no alternatives.',
    '',
    'The line:',
    text
  ].join('\n')
}

export class NoRewriteProviderError extends Error {
  constructor(label: string) {
    super(
      `${label} cannot rewrite text. Choose a provider with a model behind it in Settings → Narration.`
    )
  }
}

export async function rewriteText(
  request: RewriteRequest,
  baseDir: string = homedir()
): Promise<string> {
  const provider = narrationProvider(readSettings(baseDir).narration.provider)

  // The built-in provider writes from a template and has no model to ask.
  if (!provider.complete) throw new NoRewriteProviderError(provider.label)

  const answer = cleanDraft(await provider.complete(buildRewritePrompt(request)))
  if (!answer.trim()) throw new Error('The model returned nothing to put back.')

  return answer
}
