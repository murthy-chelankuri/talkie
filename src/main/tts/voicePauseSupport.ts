import { execFile } from 'child_process'
import { mkdtempSync, rmSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { getWavDurationSeconds } from './wavDuration'
import { DEFAULT_PROSODY, toSpokenMarkup } from './prosody'

const execFileAsync = promisify(execFile)

/**
 * Whether `voice` actually comes out longer, not shorter, once real narration's mix of commands
 * is embedded in it.
 *
 * macOS lists some names twice under one label — a classic voice built on the old speech
 * synthesizer, and a newer Siri-based one — with nothing in `say -v '?'` to tell them apart, and
 * `-v <name>` resolving to whichever one macOS picks. Classic voices honour the embedded commands
 * `prosody.ts` relies on for natural pauses; measured directly, at least one Siri voice does not,
 * and the failure is not "no pause" — a two-sentence take with one pause between them came out
 * fine, but three sentences with commas inside them, `[[rate]]`, and a `[[pbas]]` step per
 * sentence came out *shorter* than the same text with no markup at all, worse than not pausing.
 * That combination, not a single isolated `[[slnc]]`, is what a real narration line looks like —
 * so the check has to use it rather than a smaller case that keeps missing the failure.
 */
const CALIBRATION_TEXT =
  'This is the watchlist, showing your tracked stocks. Click any row to see details, charts, ' +
  'and recent news. You can add a new symbol using the search bar at the top.'

/** Comfortably below what a real narration take's pauses added on a voice that honours them. */
const HONOURS_THRESHOLD_SECONDS = 0.4

const cache = new Map<string, Promise<boolean>>()

export function voiceHonoursPauses(voice: string): Promise<boolean> {
  const cached = cache.get(voice)
  if (cached) return cached

  const result = calibrate(voice)
  cache.set(voice, result)
  return result
}

/** So a test (or a voice reinstalled between recordings) can be measured again. */
export function forgetVoicePauseSupport(voice?: string): void {
  if (voice) cache.delete(voice)
  else cache.clear()
}

async function calibrate(voice: string): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-voice-check-'))
  try {
    const marked = toSpokenMarkup(CALIBRATION_TEXT, DEFAULT_PROSODY)
    const withPause = await measure(voice, marked, join(dir, 'with.aiff'))
    const without = await measure(voice, CALIBRATION_TEXT, join(dir, 'without.aiff'))
    return withPause - without > HONOURS_THRESHOLD_SECONDS
  } catch {
    // A voice that cannot even manage this plain a request will fail synthesis outright either
    // way; assuming the best here just lets that real failure surface on its own path.
    return true
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function measure(voice: string, text: string, aiffPath: string): Promise<number> {
  const wavPath = aiffPath.replace(/\.aiff$/, '.wav')
  await execFileAsync('say', ['-v', voice, '-o', aiffPath, text])
  await execFileAsync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiffPath, wavPath])
  const seconds = getWavDurationSeconds(wavPath)
  unlinkSync(wavPath)
  return seconds
}
