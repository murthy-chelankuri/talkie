import { execFile } from 'child_process'
import { promisify } from 'util'

import { readSettings } from '../settings/settingsStore'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync } from 'fs'

const execFileAsync = promisify(execFile)

// The voice list used to be read from `say -v`; with Kokoro the only engine the voices are a
// fixed set the engine names itself (see kokoroTtsProvider). The shared type lives with the
// provider interface; it is re-exported here because the renderer and preload reach it through
// this module.
export type { Voice } from './ttsProvider'

/**
 * Hear a voice before committing a project to it.
 *
 * Kokoro has no way to play audio of its own, so its preview is synthesised to a scratch file and
 * played by the system — the same words through the same engine that will read the narration,
 * which is the only preview worth having.
 */
export async function previewVoice(name: string, text: string): Promise<void> {
  const speech = readSettings().speech
  const { engineOfVoice, speechEngine } = await import('./engineRegistry')
  // Heard in the engine that will read it, which the voice says — not the app's: a project's own
  // picker offers the voice it is set to.
  const engine = engineOfVoice(name)
  const options = {
    voice: name,
    pace: speech.pace,
    sentencePauseMs: speech.sentencePauseMs,
    clausePauseMs: speech.clausePauseMs
  }

  const scratch = join(tmpdir(), `talkie-preview-${Date.now()}.wav`)
  try {
    await speechEngine(engine).synthesize(text, scratch, options)
    await execFileAsync('afplay', [scratch], { timeout: 60_000 })
  } finally {
    try {
      unlinkSync(scratch)
    } catch {
      // Already gone, or never written because the engine failed first.
    }
  }
}
