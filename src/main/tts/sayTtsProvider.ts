import { execFile } from 'child_process'
import { promisify } from 'util'
import { rmSync, unlinkSync } from 'fs'
import type { SpeechOptions, TTSProvider } from './ttsProvider'
import { DEFAULT_VOICE } from '../settings/schema'
import { WHOLE_ARC, toSpokenMarkup, toSpokenPieces } from './prosody'
import { listVoices } from './listVoices'
import { voiceHonoursPauses } from './voicePauseSupport'
import { getWavDurationSeconds } from './wavDuration'
import { assembleTake } from '../transcript/assembleTake'

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
    // Explicit voice: on machines with no SelectedVoiceName preference set,
    // `say` without -v silently resolves to a non-functional stub voice that
    // writes a near-empty (near-silent) audio file instead of erroring.
    // Passing an installed, known-good voice avoids that unresolved-default path,
    // so a blank setting falls back to the default rather than omitting the flag.
    // Taken from the caller, not read from settings here: a project can speak in a voice of its
    // own, and an engine that looks the voice up itself would say the words in the app's voice
    // while the take was labelled with the project's.
    const voice = options.voice.trim() || DEFAULT_VOICE
    const settings = {
      pace: options.pace,
      sentencePauseMs: options.sentencePauseMs,
      clausePauseMs: options.clausePauseMs
    }

    if (await voiceHonoursPauses(voice)) {
      await synthesizeMarkedUp(text, outputPath, voice, settings, options.arc)
    } else {
      await synthesizeBySegment(text, outputPath, voice, settings, options.arc)
    }
  }
}

async function synthesizeOne(text: string, outputPath: string, voice: string): Promise<void> {
  const aiffPath = outputPath.replace(/\.wav$/, '.aiff')
  await execFileAsync('say', ['-v', voice, '-o', aiffPath, text])
  await execFileAsync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiffPath, outputPath])
  unlinkSync(aiffPath)
}

/** One call to the voice, pauses and pitch embedded as commands it is trusted to honour. */
async function synthesizeMarkedUp(
  text: string,
  outputPath: string,
  voice: string,
  settings: { pace: number; sentencePauseMs: number; clausePauseMs: number },
  arc: SpeechOptions['arc']
): Promise<void> {
  // Marked up rather than read flat: pace, pauses at punctuation, and a pitch that drifts
  // down across the paragraph are what separate explaining from reciting.
  const spoken = toSpokenMarkup(text, settings, arc)
  await synthesizeOne(spoken || text, outputPath, voice)
}

/**
 * One call per clause, spliced together with real silence — for a voice that cannot be trusted
 * with `[[slnc]]`. See `voicePauseSupport.ts` for why some voices need this rather than the
 * single call above: on at least one, several embedded commands in one utterance came out
 * shorter than plain text, silently dropping every pause rather than merely ignoring one.
 */
async function synthesizeBySegment(
  text: string,
  outputPath: string,
  voice: string,
  settings: { pace: number; sentencePauseMs: number; clausePauseMs: number },
  arc: SpeechOptions['arc']
): Promise<void> {
  const pieces = toSpokenPieces(text, settings, arc ?? WHOLE_ARC)
  if (pieces.length === 0) return synthesizeMarkedUp(text, outputPath, voice, settings, arc)

  const parts: { at: number; wavPath: string }[] = []
  try {
    let cursor = 0
    for (const [index, piece] of pieces.entries()) {
      const wavPath = `${outputPath}.part${index}.wav`
      // Each piece is its own call, so pace and its own pitch step still need embedding —
      // only the pause between pieces moves from a command to real silence.
      const spoken = toSpokenMarkup(piece.text, { ...settings, sentencePauseMs: 0, clausePauseMs: 0 }, piece.arc)
      await synthesizeOne(spoken || piece.text, wavPath, voice)

      parts.push({ at: cursor, wavPath })
      cursor += getWavDurationSeconds(wavPath) + piece.pauseAfterMs / 1000
    }

    // The gaps are already the exact pauses asked for; no further breath room on top.
    assembleTake(parts, outputPath, 0)
  } finally {
    for (const part of parts) rmSync(part.wavPath, { force: true })
  }
}
