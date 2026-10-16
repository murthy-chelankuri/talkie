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

/**
 * Local model runners all speak the OpenAI chat-completions API, so one provider covers them
 * all. These are their default addresses, tried in order when none is configured.
 */
export const KNOWN_LOCAL_ENDPOINTS = [
  { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
  { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
  { label: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1' },
  { label: 'Jan', baseUrl: 'http://127.0.0.1:1337/v1' }
]

const PROBE_TIMEOUT_MS = 2_000
const DRAFT_TIMEOUT_MS = 600_000

/**
 * A reasoning model spends tokens thinking before it answers, and that thinking comes back in
 * a separate field. The ceiling has to leave room for both or the answer arrives empty.
 */
const REASONING_HEADROOM_TOKENS = 2_000

/** Room for an answer and for a reasoning model's thinking ahead of it. */
const MAX_ANSWER_TOKENS = 1_200 + REASONING_HEADROOM_TOKENS

export interface LocalServer {
  baseUrl: string
  label: string
  models: string[]
}

async function listModels(baseUrl: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<string[] | null> {
  try {
    const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return null
    const body = (await response.json()) as { data?: Array<{ id?: string }> }
    return (body.data ?? []).map((entry) => entry.id ?? '').filter(Boolean)
  } catch {
    return null
  }
}

/** An embedding model cannot write narration, so it should never be offered as a choice. */
function usableModels(models: string[]): string[] {
  return models.filter((id) => !/embed/i.test(id))
}

/**
 * Find the local server to talk to: the configured one if there is one, otherwise whichever
 * well-known runner is actually listening.
 */
export async function findLocalServer(): Promise<LocalServer | null> {
  const configured = readSettings().narration.local.baseUrl.trim()

  if (configured) {
    const models = await listModels(configured)
    return models ? { baseUrl: configured, label: 'Configured server', models: usableModels(models) } : null
  }

  for (const endpoint of KNOWN_LOCAL_ENDPOINTS) {
    const models = await listModels(endpoint.baseUrl)
    if (models) return { baseUrl: endpoint.baseUrl, label: endpoint.label, models: usableModels(models) }
  }

  return null
}

/**
 * Narration from a model running on this machine, through any server that speaks the OpenAI
 * chat-completions API — LM Studio, Ollama, llama.cpp, Jan and the rest.
 *
 * The only provider where nothing leaves the computer and no draft costs anything, which makes
 * it the right choice for a recording of something private.
 */
export const localProvider: NarrationProvider = {
  id: 'local',
  label: 'Local model',
  sendsDataOffMachine: false,

  async isAvailable(): Promise<ProviderAvailability> {
    const server = await findLocalServer()
    if (!server) {
      const configured = readSettings().narration.local.baseUrl.trim()
      return {
        available: false,
        reason: configured
          ? `Nothing is answering at ${configured}.`
          : 'No local model server found. Start LM Studio, Ollama or another OpenAI-compatible server.'
      }
    }

    if (server.models.length === 0) {
      return { available: false, reason: `${server.label} is running but has no usable model loaded.` }
    }

    const chosen = readSettings().narration.local.model.trim()
    if (chosen && !server.models.includes(chosen)) {
      return { available: false, reason: `${server.label} has no model called "${chosen}".` }
    }

    return { available: true }
  },

  async complete(prompt: string, budget?: CompleteBudget): Promise<string> {
    return askLocal([{ role: 'user', content: prompt }], budget)
  },

  async draft(request: NarrationRequest): Promise<string> {
    const images = request.evidence.framePaths.map((path) => ({
      type: 'image_url' as const,
      image_url: { url: `data:${mediaTypeFor(path)};base64,${readFileSync(path).toString('base64')}` }
    }))

    return askLocal([{ role: 'user', content: [{ type: 'text', text: buildPrompt(request) }, ...images] }])
  }
}

/** One request to the local server, shared by drafting narration and answering a plain prompt. */
async function askLocal(messages: unknown[], budget?: CompleteBudget): Promise<string> {
  const server = await findLocalServer()
  if (!server) throw new Error('No local model server is reachable.')

  const configured = readSettings().narration.local.model.trim()
  const model = configured || server.models[0]
  if (!model) throw new Error(`${server.label} has no model loaded to answer with.`)

  const response = await fetch(`${server.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(budget?.timeoutMs ?? DRAFT_TIMEOUT_MS),
    body: JSON.stringify({ model, max_tokens: budget?.maxTokens ? budget.maxTokens + REASONING_HEADROOM_TOKENS : MAX_ANSWER_TOKENS, messages })
  })

  if (!response.ok) {
    throw new Error(`${server.label} refused the request (${response.status}): ${await shortBody(response)}`)
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
  }
  const choice = body.choices?.[0]
  const content = choice?.message?.content?.trim()

  if (!content) {
    // A reasoning model that ran out of room answers with thinking and no conclusion.
    throw new Error(
      choice?.message?.reasoning_content
        ? `"${model}" spent its whole answer thinking. Give it a larger context in ${server.label}, or pick a smaller model.`
        : `"${model}" returned nothing.`
    )
  }

  return cleanDraft(content)
}

async function shortBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300)
  } catch {
    return 'no details'
  }
}
