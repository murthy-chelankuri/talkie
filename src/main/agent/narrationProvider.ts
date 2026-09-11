import { extname } from 'path'
import type { ClipEvidence } from './clipEvidence'
import type { NarrationProviderId } from '../settings/schema'

export interface NarrationRequest {
  evidence: ClipEvidence
  projectName: string
  /** 1-based position of this clip in the demo, so narration can place itself. */
  clipIndex: number
  clipCount: number
}

export interface ProviderAvailability {
  available: boolean
  /** What the user must do about it — shown in settings when unavailable. */
  reason?: string
}

export interface NarrationProvider {
  readonly id: NarrationProviderId
  readonly label: string
  /** Whether frames and logs leave the machine when this provider is used. */
  readonly sendsDataOffMachine: boolean
  isAvailable(): Promise<ProviderAvailability>
  draft(request: NarrationRequest): Promise<string>
}

/** Speech runs at roughly this rate, so it sets how much text a clip can hold. */
const WORDS_PER_SECOND = 2.5

export function targetWordCount(durationSeconds: number): number {
  return Math.max(8, Math.round(durationSeconds * WORDS_PER_SECOND))
}

/**
 * The instructions every model-backed provider sends. Kept in one place so the three of them
 * produce comparable narration and can be judged against each other.
 */
export function buildPrompt(request: NarrationRequest): string {
  const { evidence, projectName, clipIndex, clipCount } = request
  const words = targetWordCount(evidence.durationSeconds)

  const lines = [
    `You are writing voice-over narration for one clip of a product demo called "${projectName}".`,
    `This is clip ${clipIndex} of ${clipCount}. It is on screen for ${evidence.durationSeconds.toFixed(1)} seconds.`,
    ''
  ]

  if (evidence.actions.length > 0) {
    lines.push('Recorded while this clip was on screen:')
    for (const action of evidence.actions) {
      lines.push(`  ${action.atSeconds.toFixed(1)}s  ${action.label}`)
    }
    lines.push('')
    lines.push(
      'That log is machine-generated and imperfect: ignore anything that looks like an advertising',
      'or analytics endpoint rather than something the presenter did.',
      ''
    )
  }

  if (evidence.framePaths.length > 0) {
    lines.push(
      evidence.kind === 'image'
        ? 'The still image for this clip is attached. Describe what it actually shows.'
        : `${evidence.framePaths.length} screenshots sampled across the clip are attached, in order.`,
      ''
    )
  }

  lines.push(
    'Write the narration to be spoken aloud over this clip.',
    `- About ${words} words. Going long means the voice runs past the clip.`,
    '- Plain spoken English, present tense, second person or neutral.',
    '- Describe what the viewer can see. Never invent a feature, product name, number or claim.',
    '- No markdown, no headings, no bullet points, no stage directions, no quotation marks around the whole thing.',
    '- Reply with the narration and nothing else.'
  )

  return lines.join('\n')
}

/** Media type for an image path, for providers that must declare one. */
export function mediaTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    default:
      return 'image/jpeg'
  }
}

/**
 * Models are asked for bare narration but sometimes wrap it anyway. Strip the wrapping rather
 * than letting a stray fence or label end up being read aloud.
 */
export function cleanDraft(raw: string): string {
  let text = raw.trim()

  const fenced = text.match(/^```(?:\w+)?\n([\s\S]*?)\n?```$/)
  if (fenced) text = fenced[1].trim()

  text = text.replace(/^(?:narration|voice-?over|script)\s*:\s*/i, '')

  // A whole answer wrapped in quotes would be read out with the quotes.
  if (text.length > 1 && /^["'“]/.test(text) && /["'”]$/.test(text)) {
    text = text.slice(1, -1).trim()
  }

  return text
}
