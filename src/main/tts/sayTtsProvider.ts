import { execFile } from 'child_process'
import { promisify } from 'util'
import { unlinkSync } from 'fs'
import type { SpeechOptions, TTSProvider } from './ttsProvider'
import { DEFAULT_VOICE } from '../settings/schema'
import { toSpokenMarkup } from './prosody'
import { listVoices } from './listVoices'

const execFileAsync = promisify(execFile)

export const sayTtsProvider: TTSProvider = {
  id: 'system',
  label: "macOS's built-in voices",

  async voices() {
    return listVoices()
  },

  async isAvailable() {
    return process.platform === 'darwin'
      ? { available: true }
      : { available: false, reason: 'The built-in voices are only available on macOS.' }
  },

  async synthesize(text: string, outputPath: string, options: SpeechOptions): Promise<void> {
    const aiffPath = outputPath.replace(/\.wav$/, '.aiff')

    // Explicit voice: on machines with no SelectedVoiceName preference set,
    // `say` without -v silently resolves to a non-functional stub voice that
    // writes a near-empty (near-silent) audio file instead of erroring.
    // Passing an installed, known-good voice avoids that unresolved-default path,
    // so a blank setting falls back to the default rather than omitting the flag.
    // Taken from the caller, not read from settings here: a project can speak in a voice of its
    // own, and an engine that looks the voice up itself would say the words in the app's voice
    // while the take was labelled with the project's.
    const voice = options.voice.trim() || DEFAULT_VOICE

    // Marked up rather than read flat: pace, pauses at punctuation, and a pitch that drifts
    // down across the paragraph are what separate explaining from reciting.
    const spoken = toSpokenMarkup(
      text,
      {
        pace: options.pace,
        sentencePauseMs: options.sentencePauseMs,
        clausePauseMs: options.clausePauseMs
      },
      options.arc
    )

    await execFileAsync('say', ['-v', voice, '-o', aiffPath, spoken || text])
    await execFileAsync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiffPath, outputPath])

    unlinkSync(aiffPath)
  }
}
