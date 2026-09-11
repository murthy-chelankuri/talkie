import { readFileSync } from 'fs'
import {
  buildPrompt,
  cleanDraft,
  type NarrationProvider,
  type NarrationRequest,
  type ProviderAvailability
} from './narrationProvider'
import { readSettings } from '../settings/settingsStore'

const AVAILABILITY_TIMEOUT_MS = 3_000
const DRAFT_TIMEOUT_MS = 300_000

/**
 * Narration from a model running on this machine through Ollama.
 *
 * The only provider where nothing leaves the computer and no draft costs anything, which is
 * what makes it the right choice for a recording of something private. In exchange it needs
 * Ollama installed and a vision model pulled, so availability checks say exactly what is
 * missing and how to fix it.
 */
export const ollamaProvider: NarrationProvider = {
  id: 'ollama',
  label: 'Ollama (on this machine)',
  sendsDataOffMachine: false,

  async isAvailable(): Promise<ProviderAvailability> {
    const { baseUrl, model } = readSettings().narration.ollama

    let tags: { models?: Array<{ name?: string }> }
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(AVAILABILITY_TIMEOUT_MS)
      })
      if (!response.ok) throw new Error(`responded ${response.status}`)
      tags = (await response.json()) as { models?: Array<{ name?: string }> }
    } catch {
      return {
        available: false,
        reason: `No Ollama at ${baseUrl}. Install it from ollama.com, then run \`ollama serve\`.`
      }
    }

    // A tag may carry a version suffix, so "llava" should match "llava:latest".
    const installed = (tags.models ?? []).map((entry) => entry.name ?? '')
    const hasModel = installed.some((name) => name === model || name.startsWith(`${model}:`))

    return hasModel
      ? { available: true }
      : { available: false, reason: `Ollama has no model called "${model}". Run \`ollama pull ${model}\`.` }
  },

  async draft(request: NarrationRequest): Promise<string> {
    const { baseUrl, model } = readSettings().narration.ollama

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: 'user',
            content: buildPrompt(request),
            images: request.evidence.framePaths.map((path) => readFileSync(path).toString('base64'))
          }
        ]
      })
    })

    if (!response.ok) {
      throw new Error(`Ollama refused the request (${response.status}): ${await response.text()}`)
    }

    const body = (await response.json()) as { message?: { content?: string } }
    const content = body.message?.content
    if (!content?.trim()) {
      throw new Error(`Ollama returned nothing for model "${model}".`)
    }

    return cleanDraft(content)
  }
}
