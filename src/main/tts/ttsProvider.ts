/** How a take should sound, decided by the caller rather than read from settings by each engine. */
export interface SpeechOptions {
  voice: string
  /** Words a minute. Honoured by engines that can be told; ignored by those that cannot. */
  pace: number
  sentencePauseMs: number
  clausePauseMs: number
}

export interface TTSProvider {
  readonly id: string
  readonly label: string
  synthesize: (text: string, outputPath: string, options: SpeechOptions) => Promise<void>
  /** The voices this engine can use. */
  voices: () => Promise<Voice[]>
  isAvailable: () => Promise<{ available: boolean; reason?: string }>
}

export interface Voice {
  name: string
  locale: string
  sample: string
  novelty: boolean
}
