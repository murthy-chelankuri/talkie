import { readFileSync } from 'fs'
import {
  buildPrompt,
  cleanDraft,
  mediaTypeFor,
  targetWordCount,
  type NarrationProvider,
  type NarrationRequest,
  type ProviderAvailability,
  type CompleteBudget
} from './narrationProvider'
import { readSettings } from '../settings/settingsStore'

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
const DRAFT_TIMEOUT_MS = 120_000

/**
 * Narration from the Anthropic API with the user's own key.
 *
 * Plain `fetch` rather than the SDK: the Messages API is one POST, and avoiding the dependency
 * keeps the app's install small. Independent of whether the Claude CLI happens to be installed.
 */
export const anthropicProvider: NarrationProvider = {
  id: 'anthropic',
  label: 'Anthropic API',
  sendsDataOffMachine: true,

  async isAvailable(): Promise<ProviderAvailability> {
    const { apiKey } = readSettings().narration.anthropic
    return apiKey.trim()
      ? { available: true }
      : { available: false, reason: 'Add an Anthropic API key in settings to use this provider.' }
  },

  async complete(prompt: string, budget?: CompleteBudget): Promise<string> {
    return askAnthropic([{ type: 'text', text: prompt }], budget?.maxTokens ?? 1500, budget?.timeoutMs)
  },

  async draft(request: NarrationRequest): Promise<string> {
    const images = request.evidence.framePaths.map((path) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: mediaTypeFor(path),
        data: readFileSync(path).toString('base64')
      }
    }))

    // Narration is short; a tight ceiling keeps a runaway answer from costing real money.
    return askAnthropic(
      [...images, { type: 'text', text: buildPrompt(request) }],
      Math.max(256, targetWordCount(request.evidence.durationSeconds) * 4)
    )
  }
}

/** One request to the Messages API, shared by narration and by anything else asked of it. */
async function askAnthropic(content: unknown[], maxTokens: number, timeoutMs: number = DRAFT_TIMEOUT_MS): Promise<string> {
  const { apiKey, model } = readSettings().narration.anthropic
  if (!apiKey.trim()) throw new Error('No Anthropic API key is set.')

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content }] })
  })

  if (!response.ok) {
    // The key must never be echoed back into an error the UI will display.
    throw new Error(`The Anthropic API refused the request (${response.status}). Check the key and model in settings.`)
  }

  const body = (await response.json()) as { content?: Array<{ type?: string; text?: string }> }
  const text = body.content?.find((block) => block.type === 'text')?.text
  if (!text?.trim()) throw new Error('The Anthropic API returned nothing.')

  return cleanDraft(text)
}
