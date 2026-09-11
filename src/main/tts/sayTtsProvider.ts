import { execFile } from 'child_process'
import { promisify } from 'util'
import { unlinkSync } from 'fs'
import type { TTSProvider } from './ttsProvider'
import { readSettings } from '../settings/settingsStore'
import { DEFAULT_VOICE } from '../settings/schema'

const execFileAsync = promisify(execFile)

export const sayTtsProvider: TTSProvider = {
  async synthesize(text: string, outputPath: string): Promise<void> {
    const aiffPath = outputPath.replace(/\.wav$/, '.aiff')

    // Explicit voice: on machines with no SelectedVoiceName preference set,
    // `say` without -v silently resolves to a non-functional stub voice that
    // writes a near-empty (near-silent) audio file instead of erroring.
    // Passing an installed, known-good voice avoids that unresolved-default path,
    // so a blank setting falls back to the default rather than omitting the flag.
    const voice = readSettings().speech.voice.trim() || DEFAULT_VOICE
    await execFileAsync('say', ['-v', voice, '-o', aiffPath, text])
    await execFileAsync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiffPath, outputPath])

    unlinkSync(aiffPath)
  }
}
