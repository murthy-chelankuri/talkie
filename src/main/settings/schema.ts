import { z } from 'zod'

/** Ships with every macOS and is known to produce real audio. */
export const DEFAULT_VOICE = 'Samantha'

/** Words per minute. Lower sounds like explaining; higher like reading out. */
export const DEFAULT_PACE = 170

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

/**
 * The Claude CLI resolves these itself; there is no API to ask it what a full model name is, so
 * only the account-independent aliases it documents are offered. Empty means "let the CLI and
 * account decide", which is what every build did before this setting existed.
 */
export const CLAUDE_CLI_MODEL_IDS = ['', 'sonnet', 'opus', 'haiku', 'fable'] as const

export const ClaudeCliSettingsSchema = z.object({
  model: z.enum(CLAUDE_CLI_MODEL_IDS).default('')
})

/**
 * Copilot CLI's catalogue is read live off the CLI itself (see copilotModels.ts) rather than
 * fixed here, since it changes as GitHub adds and retires models — so this is a plain string,
 * not an enum. Empty means "auto", which is also the only choice guaranteed to work on every
 * plan.
 */
export const CopilotCliSettingsSchema = z.object({
  model: z.string().default('')
})

export const NarrationSettingsSchema = z.object({
  /** Draft narration by itself when a clip lands on the timeline. */
  autoDraft: z.boolean().default(true),
  provider: z
    // An older build called the local provider "ollama", when it spoke only to Ollama.
    .preprocess((value) => (value === 'ollama' ? 'local' : value), z.enum(NARRATION_PROVIDER_IDS))
    .default('template'),
  local: LocalModelSettingsSchema.default({}),
  anthropic: AnthropicSettingsSchema.default({}),
  claudeCli: ClaudeCliSettingsSchema.default({}),
  copilotCli: CopilotCliSettingsSchema.default({})
})

/**
 * Engines that can read narration aloud, both on this machine. `system` needs nothing installed;
 * `kokoro` needs its server running and sounds much closer to a person.
 */
export const SPEECH_ENGINE_IDS = ['system', 'kokoro'] as const

/**
 * Earlier builds could also speak through OpenAI and Azure. A settings file that still names one
 * would otherwise fail to parse — and an invalid file is replaced wholesale with defaults, which
 * would quietly cost someone every other setting they had. So the engine falls back to the
 * built-in voices, and the voice with it: "nova" means nothing to `say`.
 */
function withoutRemovedEngines(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const speech = value as Record<string, unknown>
  // Only the engines that existed: anything else is still an invalid setting, not a migration.
  if (speech.engine !== 'openai' && speech.engine !== 'azure') return value
  return { ...speech, engine: 'system', voice: DEFAULT_VOICE }
}

/** Kokoro's voices are named for their language and sex — af_heart, bm_george — as no Mac voice is. */
export const KOKORO_VOICE_NAME = /^[a-z][fm]_[a-z0-9_]+$/

export const DEFAULT_KOKORO_VOICE = 'af_heart'

/**
 * The app's voice is always one its engine has.
 *
 * Changing the engine in Settings used to leave the voice behind: moved from Kokoro to the Mac's
 * voices, the app went on naming af_heart, every project following it was handed to `say` with a
 * voice it has never heard of, and the editor kept showing a Kokoro voice the app no longer used.
 * Settled here, where every write and every read passes, so a file already in that state reads
 * right too.
 */
function voiceOfItsEngine(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const speech = value as Record<string, unknown>
  const voice = typeof speech.voice === 'string' ? speech.voice.trim() : ''
  const isKokoro = KOKORO_VOICE_NAME.test(voice)
  if (speech.engine === 'kokoro' && !isKokoro) return { ...speech, voice: DEFAULT_KOKORO_VOICE }
  if (speech.engine !== 'kokoro' && isKokoro) return { ...speech, voice: DEFAULT_VOICE }
  return value
}

/** The voice that reads the narration, and the engine it comes from. */
export const SpeechSettingsSchema = z.preprocess(
  (value) => voiceOfItsEngine(withoutRemovedEngines(value)),
  z.object({
    /**
     * Which engine speaks. The built-in voices are enough to hear whether the words work; a
     * published video usually wants Kokoro.
     */
    engine: z.enum(SPEECH_ENGINE_IDS).default('system'),
    voice: z.string().default(DEFAULT_VOICE),
    /** Words per minute. Lower sounds like explaining; higher like reading out. */
    pace: z.number().min(90).max(300).default(DEFAULT_PACE),
    /** Silence at a full stop, in milliseconds. */
    sentencePauseMs: z.number().min(0).max(2000).default(420),
    /** Silence at a comma or dash, in milliseconds. */
    clausePauseMs: z.number().min(0).max(1000).default(300)
  })
)

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
  tokenCreatedAt: z.string().default(''),
  /**
   * sha256 of a token Talkie minted for one run of its own agent.
   *
   * A second slot rather than reuse of `tokenHash`, so asking Talkie to do something for you
   * cannot quietly revoke the token an outside agent is already holding. It grants nothing on
   * its own: agent access still has to be turned on, exactly as for anyone else, and this is
   * cleared the moment the run ends.
   */
  runTokenHash: z.string().default('')
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
  highlightColour: z.string().default('#7ab5f0'),
  /**
   * Record a site whose certificate the machine does not trust.
   *
   * A build running on a development box is usually served over https with a self-signed
   * certificate or an internal authority, and the browser refuses to load it — which is the
   * whole recording, not a corner of it. Off by default, because turning it on means the
   * recording browser will no longer notice that a page is being intercepted, and the demo
   * being recorded is often being logged into. It applies only to the browser a recording is
   * made in; Talkie's own windows are unaffected.
   */
  allowUntrustedCertificates: z.boolean().default(false)
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
export type ClaudeCliModelId = (typeof CLAUDE_CLI_MODEL_IDS)[number]
export type McpSettings = z.infer<typeof McpSettingsSchema>
export type RecordingSettings = z.infer<typeof RecordingSettingsSchema>
export type ExportSettings = z.infer<typeof ExportSettingsSchema>
export type NarrationSettings = z.infer<typeof NarrationSettingsSchema>
export type SpeechEngineId = (typeof SPEECH_ENGINE_IDS)[number]
export type SpeechSettings = z.infer<typeof SpeechSettingsSchema>
export type Settings = z.infer<typeof SettingsSchema>
