/** How a take should sound, decided by the caller rather than read from settings by each engine. */
export interface SpeechOptions {
  voice: string
  /** Words a minute. Honoured by engines that can be told; ignored by those that cannot. */
  pace: number
  /**
   * Silence at a full stop and at a comma, in milliseconds. Kokoro shapes a paragraph's pauses
   * by itself and ignores these; they are kept because settings still carry them and a second
   * engine may yet honour them.
   */
  sentencePauseMs: number
  clausePauseMs: number
}

export interface TTSProvider {
  readonly id: string
  readonly label: string
  /** One line on what choosing it means, shown under its name. */
  readonly description: string
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
  /** Which engine reads it, where voices from more than one are listed together. */
  engine?: 'kokoro'
}
