import { z } from 'zod'

/** Ships with every macOS and is known to produce real audio. */
export const DEFAULT_VOICE = 'Samantha'

/** Providers that can draft a clip's narration. `template` needs nothing installed. */
export const NARRATION_PROVIDER_IDS = ['template', 'claude-cli', 'local', 'anthropic'] as const

export const LocalModelSettingsSchema = z.object({
  /**
   * Address of an OpenAI-compatible server. Blank means "find one" — LM Studio, Ollama,
   * llama.cpp and Jan all serve the same API on their own default ports.
   */
  baseUrl: z.string().default(''),
  /** Blank means "use whatever the server has loaded". */
  model: z.string().default('')
})

export const AnthropicSettingsSchema = z.object({
  apiKey: z.string().default(''),
  model: z.string().default('claude-sonnet-5')
})

export const NarrationSettingsSchema = z.object({
  /** Draft narration by itself when a clip lands on the timeline. */
  autoDraft: z.boolean().default(true),
  provider: z
    // An older build called the local provider "ollama", when it spoke only to Ollama.
    .preprocess((value) => (value === 'ollama' ? 'local' : value), z.enum(NARRATION_PROVIDER_IDS))
    .default('template'),
  local: LocalModelSettingsSchema.default({}),
  anthropic: AnthropicSettingsSchema.default({})
})

/** The macOS voice that reads the narration. Named explicitly — see sayTtsProvider. */
export const SpeechSettingsSchema = z.object({
  voice: z.string().default(DEFAULT_VOICE),
  /** Words per minute. Lower sounds like explaining; higher like reading out. */
  pace: z.number().min(90).max(300).default(170),
  /** Silence at a full stop, in milliseconds. */
  sentencePauseMs: z.number().min(0).max(2000).default(420),
  /** Silence at a comma or dash, in milliseconds. */
  clausePauseMs: z.number().min(0).max(1000).default(300)
})

export const SettingsSchema = z.object({
  narration: NarrationSettingsSchema.default({}),
  speech: SpeechSettingsSchema.default({})
})

export type NarrationProviderId = (typeof NARRATION_PROVIDER_IDS)[number]
export type NarrationSettings = z.infer<typeof NarrationSettingsSchema>
export type SpeechSettings = z.infer<typeof SpeechSettingsSchema>
export type Settings = z.infer<typeof SettingsSchema>
