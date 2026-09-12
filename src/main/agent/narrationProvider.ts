import { extname } from 'path'
import type { ClipEvidence } from './clipEvidence'
import type { NarrationProviderId } from '../settings/schema'

export interface NarrationRequest {
  evidence: ClipEvidence
  projectName: string
  /** 1-based position of this clip in the demo, so narration can place itself. */
  clipIndex: number
  clipCount: number
  /** What was said over the previous clip, so this one carries on rather than restarting. */
  previousNarration?: string
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
  /**
   * Answer a prompt that has nothing to do with narration — writing a slide, or redrawing a
   * diagram from an instruction. Absent on the provider that has no model behind it.
   */
  complete?(prompt: string): Promise<string>
}

/** Speech runs at roughly this rate, so it sets how much text a clip can hold. */
const WORDS_PER_SECOND = 2.5

export function targetWordCount(durationSeconds: number): number {
  return Math.max(8, Math.round(durationSeconds * WORDS_PER_SECOND))
}

/**
 * The instructions every model-backed provider sends. Kept in one place so the three of them
 * produce comparable narration and can be judged against each other.
 *
 * The job is explaining a product to someone watching, which is not the same as describing a
 * screen. Asking for a description gets a description — a flat list of clicks that reads like
 * someone narrating to themselves — so the instructions name that failure and rule it out.
 */
export function buildPrompt(request: NarrationRequest): string {
  const { evidence, projectName, clipIndex, clipCount, previousNarration } = request
  const words = targetWordCount(evidence.durationSeconds)

  const lines = [
    `You are the presenter of a product demo called "${projectName}".`,
    'Someone is watching this video to understand what the product does and why it is worth their',
    'time. You are talking to them.',
    '',
    `This is clip ${clipIndex} of ${clipCount}, on screen for ${evidence.durationSeconds.toFixed(1)} seconds.`,
    ''
  ]

  if (previousNarration?.trim()) {
    lines.push('You have just said, over the previous clip:', `  "${previousNarration.trim()}"`, '')
  }

  if (evidence.sceneText) {
    lines.push(
      evidence.kind === 'diagram' ? 'This clip is a diagram:' : 'This clip is a slide:',
      evidence.sceneText,
      ''
    )
  }

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
        ? 'The still image for this clip is attached. Talk to what it actually shows.'
        : `${evidence.framePaths.length} screenshots sampled across the clip are attached, in order.`,
      ''
    )
  }

  lines.push(
    'Write what you say out loud over this clip.',
    `- About ${words} words. Going long means your voice runs past the clip.`,
    '- Talk to the viewer. Say what is happening and why it matters to them.',
    '- Do not read out the clicks. "You click the menu. You click State News." is a list of',
    '  instructions, not an explanation — say what is being looked for and what turns up.',
    '- Sound like a person speaking, not a caption: contractions, varied sentence length, and no',
    '  throat-clearing like "In this video" or "Here we can see".',
    '- Never invent a feature, product name, number or claim. Where you cannot tell what',
    '  something is, say plainly what is on screen instead of guessing.'
  )

  if (clipIndex === 1 && clipCount > 1) {
    lines.push('- This is the opening. Say what the viewer is about to see, then get on with it.')
  }
  if (clipIndex !== 1) {
    lines.push('- Carry on from what you just said. Do not reintroduce the product or start again.')
  }
  if (clipIndex === clipCount && clipCount > 1) {
    lines.push('- This is the last clip. Land it rather than trailing off.')
  }

  // Last, so it is the instruction closest to hand: reading the slide out is the oldest
  // mistake in presenting, and on a one-clip demo there is no opening to write — the clip is
  // the whole of it, and an introduction would crowd out what it actually says.
  if (evidence.sceneText) {
    lines.push(
      evidence.kind === 'diagram'
        ? '- The viewer can see the diagram. Say what it means and why the shape of it matters, not' +
          '\n  what each box is called.'
        : '- The viewer can already read the slide. Do not say the lines back to them — say the' +
          '\n  thing the slide is too short to say.'
    )
  }

  lines.push(
    '- No markdown, headings, bullets, stage directions or speaker labels.',
    '- Reply with the spoken words and nothing else.'
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
