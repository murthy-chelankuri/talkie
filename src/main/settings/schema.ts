import { z } from 'zod'

/** Providers that can draft a clip's narration. `template` needs nothing installed. */
export const NARRATION_PROVIDER_IDS = ['template', 'claude-cli', 'ollama', 'anthropic'] as const

export const OllamaSettingsSchema = z.object({
  baseUrl: z.string().default('http://127.0.0.1:11434'),
  model: z.string().default('llava')
})

export const AnthropicSettingsSchema = z.object({
  apiKey: z.string().default(''),
  model: z.string().default('claude-sonnet-5')
})

export const NarrationSettingsSchema = z.object({
  /** Draft narration by itself when a clip lands on the timeline. */
  autoDraft: z.boolean().default(true),
  provider: z.enum(NARRATION_PROVIDER_IDS).default('template'),
  ollama: OllamaSettingsSchema.default({}),
  anthropic: AnthropicSettingsSchema.default({})
})

export const SettingsSchema = z.object({
  narration: NarrationSettingsSchema.default({})
})

export type NarrationProviderId = (typeof NARRATION_PROVIDER_IDS)[number]
export type NarrationSettings = z.infer<typeof NarrationSettingsSchema>
export type Settings = z.infer<typeof SettingsSchema>
