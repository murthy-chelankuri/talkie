import { writeFileSync } from 'fs'
import { homedir } from 'os'
import { readSettings } from '../settings/settingsStore'
import type { SpeechOptions, TTSProvider, Voice } from './ttsProvider'

/**
 * A voice worth publishing.
 *
 * The built-in voices are enough to hear whether the words work; they are not enough to put in
 * front of a customer, and no amount of pacing and pause tuning raises that ceiling. This is the
 * same narration through a model that sounds like a person reading, at the cost of an API key
 * and the text leaving the machine — which is why it sits beside the built-in voices rather than
 * replacing them.
 */
const ENDPOINT = 'https://api.openai.com/v1/audio/speech'

/** Named for what they sound like rather than for a locale, so they are listed as one group. */
const VOICES: Voice[] = [
  { name: 'alloy', locale: 'en_US', sample: 'This is how your narration will sound.', novelty: false },
  { name: 'ash', locale: 'en_US', sample: 'This is how your narration will sound.', novelty: false },
  { name: 'ballad', locale: 'en_US', sample: 'This is how your narration will sound.', novelty: false },
  { name: 'coral', locale: 'en_US', sample: 'This is how your narration will sound.', novelty: false },
  { name: 'echo', locale: 'en_US', sample: 'This is how your narration will sound.', novelty: false },
  { name: 'fable', locale: 'en_US', sample: 'This is how your narration will sound.', novelty: false },
  { name: 'nova', locale: 'en_US', sample: 'This is how your narration will sound.', novelty: false },
  { name: 'onyx', locale: 'en_US', sample: 'This is how your narration will sound.', novelty: false },
  { name: 'sage', locale: 'en_US', sample: 'This is how your narration will sound.', novelty: false },
  { name: 'shimmer', locale: 'en_US', sample: 'This is how your narration will sound.', novelty: false }
]

export const DEFAULT_OPENAI_VOICE = 'nova'

/**
 * Said as an instruction rather than as markup.
 *
 * The built-in engine takes pace and pauses as inline markup it understands. This one takes a
 * sentence about how to read, so the same settings are turned into words — and the words are
 * about explaining rather than reciting, which is the thing the markup was tuned for.
 */
export function describeDelivery(options: SpeechOptions): string {
  const pace =
    options.pace <= 150 ? 'unhurried' : options.pace >= 200 ? 'brisk' : 'steady, conversational'

  return [
    `Read this as a presenter explaining a product to someone watching, at a ${pace} pace.`,
    'Land the full stops. Do not perform it, and do not read it like an announcement.'
  ].join(' ')
}

export const openAiTtsProvider: TTSProvider = {
  id: 'openai',
  label: 'OpenAI voices',

  async voices() {
    return VOICES
  },

  async isAvailable() {
    const key = readSettings().speech.openai.apiKey.trim()
    return key
      ? { available: true }
      : {
          available: false,
          reason: 'Add an OpenAI API key to use these voices. The key is kept in your settings file and sent only to OpenAI.'
        }
  },

  async synthesize(text: string, outputPath: string, options: SpeechOptions): Promise<void> {
    const { openai } = readSettings(homedir()).speech
    const key = openai.apiKey.trim()
    if (!key) throw new Error('No OpenAI API key is set. Add one in Settings → Voice.')

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: openai.model,
        voice: options.voice.trim() || DEFAULT_OPENAI_VOICE,
        input: text,
        instructions: describeDelivery(options),
        // The rest of the app measures narration by reading the wav header, and mixes wav.
        response_format: 'wav'
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI could not read that: ${await describeFailure(response)}`)
    }

    writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()))
  }
}

/** The service's own message, which is the only thing that distinguishes a bad key from a bad model. */
async function describeFailure(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    if (body.error?.message) return body.error.message
  } catch {
    // Not JSON; the status is all there is.
  }
  return `${response.status} ${response.statusText}`
}
