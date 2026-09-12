import { z } from 'zod'

/** Ships with every macOS and is known to produce real audio. */
export const DEFAULT_VOICE = 'Samantha'

/** Providers that can draft a clip's narration. `template` needs nothing installed. */
export const NARRATION_PROVIDER_IDS = [
  'template',
  'claude-cli',
  'copilot-cli',
  'local',
  'anthropic'
] as const

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

export const OpenAiSpeechSchema = z.object({
  apiKey: z.string().default(''),
  model: z.string().default('gpt-4o-mini-tts')
})

/** Engines that can read narration aloud. `system` needs nothing installed. */
export const SPEECH_ENGINE_IDS = ['system', 'openai'] as const

/** The voice that reads the narration, and the engine it comes from. */
export const SpeechSettingsSchema = z.object({
  /**
   * Which engine speaks. The built-in voices are enough to hear whether the words work; a
   * published video usually wants better, which is what the other one is for.
   */
  engine: z.enum(SPEECH_ENGINE_IDS).default('system'),
  voice: z.string().default(DEFAULT_VOICE),
  openai: OpenAiSpeechSchema.default({}),
  /** Words per minute. Lower sounds like explaining; higher like reading out. */
  pace: z.number().min(90).max(300).default(170),
  /** Silence at a full stop, in milliseconds. */
  sentencePauseMs: z.number().min(0).max(2000).default(420),
  /** Silence at a comma or dash, in milliseconds. */
  clausePauseMs: z.number().min(0).max(1000).default(300)
})

/**
 * Letting an outside agent drive Talkie.
 *
 * Off until it is deliberately turned on, and gated on a token even then. The server runs as a
 * local process rather than on a port, so this is not keeping anyone off a network — it is an
 * off switch the user controls and a credential they can withdraw, so that finding the server on
 * disk is not the same as being allowed to use it.
 *
 * The token is stored as a hash. Anyone who can write this file could grant themselves access
 * anyway, so the hash is not a defence against a local attacker; it means the secret is not
 * sitting in a file that gets copied into a backup, a sync folder or a bug report.
 */
export const McpSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** sha256 of the token. The token itself is shown once, when it is created. */
  tokenHash: z.string().default(''),
  /** ISO date the current token was created, so the settings screen can say how old it is. */
  tokenCreatedAt: z.string().default('')
})

/**
 * What a recording shows beyond the page itself.
 *
 * On by default: a project is watched by someone who was not driving, and a click they cannot see
 * is a step they have to be told about. It is a setting because it is baked into the video —
 * there is no taking it out afterwards.
 */
export const RecordingSettingsSchema = z.object({
  highlight: z.boolean().default(true),
  /** The ring colour, so a recording can match the product being demonstrated. */
  highlightColour: z.string().default('#d3a24c')
})

/**
 * What the finished file carries beyond the picture and the voice.
 *
 * Off by default: a subtitle file sits beside every export already, and words painted into the
 * picture cannot be corrected or translated afterwards. It is worth having when the video will
 * play muted — which is most of the web — and worth avoiding otherwise.
 */
export const ExportSettingsSchema = z.object({
  burnCaptions: z.boolean().default(false)
})

export const SettingsSchema = z.object({
  narration: NarrationSettingsSchema.default({}),
  speech: SpeechSettingsSchema.default({}),
  recording: RecordingSettingsSchema.default({}),
  export: ExportSettingsSchema.default({}),
  mcp: McpSettingsSchema.default({})
})

export type NarrationProviderId = (typeof NARRATION_PROVIDER_IDS)[number]
export type McpSettings = z.infer<typeof McpSettingsSchema>
export type RecordingSettings = z.infer<typeof RecordingSettingsSchema>
export type ExportSettings = z.infer<typeof ExportSettingsSchema>
export type NarrationSettings = z.infer<typeof NarrationSettingsSchema>
export type SpeechEngineId = (typeof SPEECH_ENGINE_IDS)[number]
export type SpeechSettings = z.infer<typeof SpeechSettingsSchema>
export type Settings = z.infer<typeof SettingsSchema>
