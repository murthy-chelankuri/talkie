import type { PitchArc } from './prosody'

/** How a take should sound, decided by the caller rather than read from settings by each engine. */
export interface SpeechOptions {
  voice: string
  /** Words a minute. Honoured by engines that can be told; ignored by those that cannot. */
  pace: number
  sentencePauseMs: number
  clausePauseMs: number
  /**
   * Which part of the take's pitch fall this piece covers.
   *
   * Absent means the text is the whole take and owns the whole fall. Timed narration is read a
   * beat at a time in separate processes, so without this every beat restarts the contour from
   * the voice's baseline and a take comes out as a row of flat, identical utterances. See
   * prosody.ts. Ignored by engines whose pitch cannot be directed.
   */
  arc?: PitchArc
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
  engine?: 'system' | 'kokoro'
}
