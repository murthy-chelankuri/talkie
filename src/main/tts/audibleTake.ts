/**
 * Kokoro, now and then, hands back a clip of pure silence.
 *
 * Not for anything in the words: one sentence in one voice at one speed comes out as seconds of
 * zeros, every time, while the same sentence 2% faster, in another voice, or cut in half reads
 * perfectly — a numerical fault inside the model. It was saved like any other take, so a scene
 * simply lost its first sentence and nothing said why.
 *
 * Checked here, on the app's side of the worker, from the file it wrote: the worker is the one
 * file allowed to touch Kokoro, and stays that way (kokoroBoundary.test.ts).
 *
 * So a silent result is never kept. The same words are asked for again at a speed nobody can hear
 * the difference in, which moves the model off whatever it tripped on; if every speed comes back
 * silent, it is an error with the words in it rather than a take with nothing in it.
 */

/** Nudges to the asked-for speed, smallest first. Two per cent is inaudible; four is barely. */
export const RETRY_NUDGES = [1.02, 0.98, 1.04]

/** Quieter than any voice ever is — the faults come back as exact zeros, or as NaN. */
const SILENCE = 1e-4

export function isSilent(samples: ArrayLike<number>): boolean {
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]
    if (Number.isNaN(sample)) return true
    if (Math.abs(sample) > SILENCE) return false
  }
  return true
}

export async function audibleTake<T extends { audio: ArrayLike<number> }>(
  text: string,
  speed: number,
  generate: (speed: number) => Promise<T>
): Promise<T> {
  const first = await generate(speed)
  // Nothing to say is allowed to sound like nothing.
  if (!text.trim() || !isSilent(first.audio)) return first

  for (const nudge of RETRY_NUDGES) {
    const again = await generate(Math.round(speed * nudge * 1000) / 1000)
    if (!isSilent(again.audio)) return again
  }

  const words = text.trim().length > 60 ? `${text.trim().slice(0, 57)}…` : text.trim()
  throw new Error(`The Kokoro voice read “${words}” as silence. Try another voice, or reword the line.`)
}

/** A 16-bit mono WAV's samples, as the worker writes them, scaled to -1…1. */
export function wavSamples(wav: Buffer): Float32Array {
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) >> 1)
  return Float32Array.from(pcm, (sample) => sample / 32768)
}
