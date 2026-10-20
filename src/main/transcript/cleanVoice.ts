import { runFfmpeg } from '../media'

/**
 * Cleaning up a take recorded in the user's own voice: the room taken out, the voice evened.
 *
 * The browser's own noise suppression runs while recording, and is gentle by design — a call has
 * to keep working in any room — so a take from a desk with a fan or a laptop's hum on it still
 * carries both. This is a second pass, after the take is whole, with what only a finished
 * recording can give: how loud the room is between the words. Every filter is FFmpeg's own, so it
 * brings nothing new to ship or to license.
 */

/** Below this the rumble is desks, air conditioning and traffic; no voice has anything there. */
const RUMBLE_HZ = 80

/** Windows the take is measured in. Short enough that a breath between words is one of them. */
const WINDOW_SECONDS = 0.1

/**
 * How far apart the quiet of the room and the voice have to be before there is a room to take out.
 * A take with no pause in it — or a test tone — has no quiet windows, and denoising it against its
 * own voice would eat the voice.
 */
const MIN_ROOM_TO_VOICE_DB = 12

/** How far above the measured floor the denoiser is told the noise sits — enough to catch all of it. */
const FLOOR_MARGIN_DB = 6

export interface TakeLevels {
  /** The room: what the quietest tenth of the take measures, in dBFS. */
  floorDb: number
  /** The voice: what the loudest tenth measures. */
  voiceDb: number
}

/**
 * Measure the room and the voice in a take, or null when it holds nothing to measure.
 *
 * Read in short windows after the rumble filter, so the denoiser is told the level of the noise
 * it will actually be handed.
 */
export async function measureTakeLevels(sourcePath: string): Promise<TakeLevels | null> {
  const window = Math.round(48000 * WINDOW_SECONDS)
  try {
    const result = await runFfmpeg([
      '-i',
      sourcePath,
      '-vn',
      '-af',
      [
        'aresample=48000',
        `highpass=f=${RUMBLE_HZ}`,
        `asetnsamples=n=${window}:p=0`,
        'astats=metadata=1:reset=1:measure_overall=RMS_level:measure_perchannel=none',
        'ametadata=print:key=lavfi.astats.Overall.RMS_level'
      ].join(','),
      '-f',
      'null',
      '-'
    ])
    return takeLevelsFrom(`${result.stdout ?? ''}${result.stderr ?? ''}`)
  } catch (err) {
    console.error('Could not measure the take before cleaning it:', err)
    return null
  }
}

/** The levels from FFmpeg's per-window readings. Pure, so the arithmetic is tested without a take. */
export function takeLevelsFrom(output: string): TakeLevels | null {
  const levels = [...output.matchAll(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)/g)]
    .map((match) => Number(match[1]))
    // Digital silence reads -inf; it is no measure of the room, which is never that quiet.
    .filter((level) => Number.isFinite(level))
    .sort((a, b) => a - b)
  if (levels.length < 5) return null

  const at = (share: number): number => levels[Math.min(levels.length - 1, Math.floor(levels.length * share))]
  return { floorDb: at(0.1), voiceDb: at(0.9) }
}

/**
 * The filters a take goes through, in order, before it is brought to the take loudness.
 *
 * - the rumble cut, always;
 * - the denoiser, told where the room sits — only when there is a room to tell apart from the voice;
 * - a compressor, so a word said louder than the rest does not jump out once the take is levelled;
 * - a de-esser, since a close microphone makes every "s" a hiss and the compressor brings them up;
 * - an expander that lowers what the denoiser left between the words — by a quarter, not to
 *   silence, since a gate that shuts reads as the line going dead. Last, so nothing after it
 *   lifts the room back up, and with the denoiser, for the same reason.
 */
export function cleanVoiceFilter(levels: TakeLevels | null): string {
  const room = levels && levels.voiceDb - levels.floorDb >= MIN_ROOM_TO_VOICE_DB ? levels : null
  const filters = [`highpass=f=${RUMBLE_HZ}`]

  // afftdn takes the floor as -80 to -20 dB; a room louder than that is past cleaning anyway.
  if (room) filters.push(`afftdn=nr=24:nf=${Math.min(-20, Math.max(-80, room.floorDb + FLOOR_MARGIN_DB)).toFixed(1)}`)

  filters.push('acompressor=threshold=-24dB:ratio=2.5:attack=8:release=150', 'deesser=i=0.3')

  // Opens a little above the room, well below the voice.
  if (room) filters.push(`agate=threshold=${Math.pow(10, (room.floorDb + 12) / 20).toFixed(5)}:ratio=2:range=0.25:attack=5:release=250`)

  return filters.join(',')
}

/** The clean-up for this take, measured from it. */
export async function cleanVoiceFilterFor(sourcePath: string): Promise<string> {
  return cleanVoiceFilter(await measureTakeLevels(sourcePath))
}
