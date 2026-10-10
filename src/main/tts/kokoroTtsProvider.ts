import { DEFAULT_PACE } from '../settings/schema'
import type { SpeechOptions, TTSProvider, Voice } from './ttsProvider'
import { KOKORO_DOWNLOAD_MB, isKokoroDownloaded } from './kokoro/kokoroModel'
import { speakWithKokoro } from './kokoro/kokoroProcess'

/**
 * Kokoro, built into the app.
 *
 * A small open neural model (Apache-2.0) that reads close to a person, with no account, no key and
 * nothing leaving the machine — the same promise the built-in voices make, at a quality they cannot
 * reach. It runs in a worker process of its own; see kokoro/kokoroWorker.ts for why. The model is
 * downloaded once, the first time someone chooses it; see kokoro/kokoroModel.ts.
 */

/** The voice Kokoro's own authors grade highest. */
export const DEFAULT_KOKORO_VOICE = 'af_heart'

const SAMPLE = 'This is how your narration will sound.'

/**
 * Kokoro's English voices, best first, with the grades its authors give them.
 *
 * Written out here rather than read from `kokoro-js`, because the main process never loads that
 * package. The grades are audible — `af_heart` (A) sounds like a person, `am_adam` (F+) does not —
 * so the top of the list is where to start rather than the alphabet's idea of it. Grade D and
 * below are left out: offering a voice that makes the app sound worse helps nobody.
 *
 * A voice name is language, gender and name: `af_heart` is American English, female, Heart.
 */
const VOICES: Array<[name: string, grade: string]> = [
  ['af_heart', 'A'],
  ['af_bella', 'A-'],
  ['af_nicole', 'B-'],
  ['bf_emma', 'B-'],
  ['af_aoede', 'C+'],
  ['af_kore', 'C+'],
  ['af_sarah', 'C+'],
  ['am_fenrir', 'C+'],
  ['am_michael', 'C+'],
  ['am_puck', 'C+'],
  ['af_alloy', 'C'],
  ['af_nova', 'C'],
  ['bf_isabella', 'C'],
  ['bm_fable', 'C'],
  ['bm_george', 'C'],
  ['af_sky', 'C-']
]

const LOCALES: Record<string, string> = { a: 'en_US', b: 'en_GB' }

export function isKokoroVoiceName(voice: string): boolean {
  return /^[a-z][fm]_[a-z0-9_]+$/.test(voice.trim())
}

/**
 * Pace as a multiple of the voice's own: at the default the voice reads at the speed it was
 * trained at, which is where it sounds most like a person.
 */
export function speedFor(pace: number): number {
  return Math.round(Math.max(0.5, Math.min(2, pace / DEFAULT_PACE)) * 100) / 100
}

export const kokoroTtsProvider: TTSProvider = {
  id: 'kokoro',
  label: 'Kokoro',
  description: 'Sounds close to a person. Built in; the voice itself is a one-time download.',

  async voices() {
    return VOICES.map(([name]): Voice => ({ name, locale: LOCALES[name[0]], sample: SAMPLE, novelty: false }))
  },

  async isAvailable() {
    return isKokoroDownloaded()
      ? { available: true }
      : { available: false, reason: `Download the voice first — about ${KOKORO_DOWNLOAD_MB} MB, once.` }
  },

  async synthesize(text: string, outputPath: string, options: SpeechOptions): Promise<void> {
    // The voice setting is shared between engines; one left over from the other is read in the
    // default voice rather than failing every clip.
    const voice = VOICES.some(([name]) => name === options.voice.trim()) ? options.voice.trim() : DEFAULT_KOKORO_VOICE

    // The whole take in one go: Kokoro shapes a paragraph as a paragraph and pauses at
    // punctuation by itself, so nothing is spliced in afterwards.
    await speakWithKokoro(text, voice, speedFor(options.pace), outputPath)
  }
}
