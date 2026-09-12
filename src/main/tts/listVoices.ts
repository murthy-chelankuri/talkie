import { execFile } from 'child_process'
import { promisify } from 'util'

import { readSettings } from '../settings/settingsStore'
import { toSpokenMarkup } from './prosody'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync } from 'fs'

const execFileAsync = promisify(execFile)

export interface Voice {
  /** The name `say -v` expects, which is also what is stored in settings. */
  name: string
  /** BCP-ish locale as macOS reports it, e.g. `en_US`. */
  locale: string
  /** The voice speaking its own name, useful as preview text. */
  sample: string
  /** A joke voice rather than a narrator — offered, but sorted last. */
  novelty: boolean
}

/**
 * Voices that exist for novelty rather than for reading anything aloud. They are still offered,
 * just not among the first things someone scrolling for a narrator has to wade through.
 */
const NOVELTY_VOICES = new Set([
  'Albert',
  'Bad News',
  'Bahh',
  'Bells',
  'Boing',
  'Bubbles',
  'Cellos',
  'Good News',
  'Jester',
  'Organ',
  'Superstar',
  'Trinoids',
  'Whisper',
  'Wobble',
  'Zarvox'
])

export function isNoveltyVoice(name: string): boolean {
  return NOVELTY_VOICES.has(name)
}

/**
 * Parse the table `say -v '?'` prints.
 *
 * Names are not a single word — `Eddy (German (Germany))` is one voice — and they are separated
 * from the locale by a single space in some rows and many in others, so the locale itself is
 * what the line is split on.
 */
export function parseVoiceList(raw: string): Voice[] {
  const voices: Voice[] = []

  for (const line of raw.split('\n')) {
    const match = line.match(/^(.*?)\s+([a-z]{2,3}(?:_[A-Z]{2})?)\s+#\s?(.*)$/)
    if (!match) continue

    const [, name, locale, sample] = match
    if (!name.trim()) continue

    voices.push({ name: name.trim(), locale, sample: sample.trim(), novelty: isNoveltyVoice(name.trim()) })
  }

  return voices
}

export async function listVoices(): Promise<Voice[]> {
  try {
    const { stdout } = await execFileAsync('say', ['-v', '?'], { maxBuffer: 4 * 1024 * 1024 })
    return parseVoiceList(stdout)
  } catch (err) {
    console.error('Could not list the installed voices:', err)
    return []
  }
}

/**
 * Speak a short line so the user can hear a voice before choosing it — with the same pacing and
 * pauses the narration will use, otherwise the preview is not what they will get.
 */
/**
 * Hear a voice before committing a project to it.
 *
 * A cloud engine has no way to play audio of its own, so its preview is synthesised to a scratch
 * file and played by the system — the same words through the same engine that will read the
 * narration, which is the only preview worth having.
 */
export async function previewVoice(name: string, text: string): Promise<void> {
  const speech = readSettings().speech
  const options = {
    voice: name,
    pace: speech.pace,
    sentencePauseMs: speech.sentencePauseMs,
    clausePauseMs: speech.clausePauseMs
  }

  if (speech.engine === 'system') {
    const spoken = toSpokenMarkup(text, options)
    await execFileAsync('say', ['-v', name, spoken || text], { timeout: 30_000 })
    return
  }

  const { speechEngine } = await import('./engineRegistry')
  const scratch = join(tmpdir(), `talkie-preview-${Date.now()}.wav`)
  try {
    await speechEngine(speech.engine).synthesize(text, scratch, options)
    await execFileAsync('afplay', [scratch], { timeout: 60_000 })
  } finally {
    try {
      unlinkSync(scratch)
    } catch {
      // Already gone, or never written because the engine failed first.
    }
  }
}
