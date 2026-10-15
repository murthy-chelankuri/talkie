import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isKokoroDownloaded } from './kokoroModel'
import { speakWithKokoro, stopKokoro } from './kokoroProcess'
import { readWavFormat } from '../wavDuration'
import { wavSamples } from '../audibleTake'

/**
 * The real worker, the real model. Skipped on a machine that has never downloaded the voice:
 * fetching 163 MB is not something a test run should do by itself.
 */
const downloaded = isKokoroDownloaded()

describe('speaking through the Kokoro worker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-kokoro-process-'))

  afterAll(() => {
    stopKokoro()
    rmSync(dir, { recursive: true, force: true })
  })

  it.skipIf(!downloaded)('writes a 16-bit take the rest of the app can time and splice', async () => {
    const out = join(dir, 'take.wav')

    const seconds = await speakWithKokoro('Built into Talkie, and nothing leaves this Mac.', 'af_heart', 1, out)

    const format = readWavFormat(out)
    expect(format.bitsPerSample).toBe(16)
    expect(format.channels).toBe(1)
    expect(format.seconds).toBeCloseTo(seconds, 2)
    expect(seconds).toBeGreaterThan(1.5)
  }, 90_000)

  /**
   * Kokoro reads 510 phonemes at most and kokoro-js drops the rest without a word. This paragraph
   * is about 800: it came back as 25 seconds of its first two thirds, read at an impossible 370
   * words a minute, and the clip's last sentences were simply never said.
   */
  const LONG = [
    'Every piece of work is a card, and every card lives in a column: what is waiting, what is in progress, and what is finished.',
    'Drag a card from one column to the next as the work moves along, and everyone on the team sees the change straight away.',
    'Open a card to read the whole story behind it, the comments people have left, the files they attached, and who is looking after it now.',
    'When a deadline is close, the card turns amber, and when it has passed, it turns red, so nothing slips by quietly.',
    'Filters along the top narrow the board to one person, one label, or one week, and the search box finds any card by a word in its title or its notes.',
    'At the end of the week, the summary view shows what moved, what stalled, and what is still waiting for someone to pick it up.'
  ]

  /** Words a minute: Kokoro at its own pace reads at about 190, never anywhere near 300. */
  const pace = (text: string, seconds: number): number => (text.split(/\s+/).length / seconds) * 60

  it.skipIf(!downloaded)('reads every word of narration longer than Kokoro takes at once', async () => {
    const text = LONG.join(' ')

    const seconds = await speakWithKokoro(text, 'af_heart', 1, join(dir, 'long.wav'))

    expect(pace(text, seconds)).toBeLessThan(260)
  }, 180_000)

  it.skipIf(!downloaded)('reads every word of one sentence too long to read at once', async () => {
    // No full stop to cut at: it has to be cut at its commas instead.
    const text = LONG.map((sentence) => sentence.replace(/\.$/, '')).join(', and ') + '.'

    const seconds = await speakWithKokoro(text, 'af_heart', 1, join(dir, 'sentence.wav'))

    expect(pace(text, seconds)).toBeLessThan(260)
  }, 180_000)

  /** The longest stretch of the take with nothing in it, in seconds. */
  function longestSilence(path: string): number {
    const samples = wavSamples(readFileSync(path))
    let longest = 0
    let run = 0
    for (const sample of samples) {
      run = Math.abs(sample) < 1e-3 ? run + 1 : 0
      longest = Math.max(longest, run)
    }
    return longest / 24_000
  }

  it.skipIf(!downloaded)('says every sentence of a long take, even ones the model first reads as silence', async () => {
    // Read alone in af_alloy at its own speed, four of these sentences come back as ten seconds of
    // zeros each. Inside an eighty-second take that was a scene going quiet halfway through, and
    // the check on the whole take passed it, because the take as a whole was not silent.
    const text =
      'This scene is about reporting, and it has a great deal to say. ' +
      Array.from(
        { length: 9 },
        (_, i) =>
          `Point ${i + 1} about reporting: the team looked at how people really use it every day, found the slow parts, and made each of them quicker, clearer and easier to explain to someone new.`
      ).join(' ')
    const path = join(dir, 'gaps.wav')

    await speakWithKokoro(text, 'af_alloy', 1, path)

    expect(longestSilence(path)).toBeLessThan(2)
  }, 300_000)

  it('refuses before the voice has been downloaded, rather than starting a download mid-clip', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'talkie-kokoro-none-'))
    try {
      await expect(speakWithKokoro('Hi.', 'af_heart', 1, join(dir, 'x.wav'), elsewhere)).rejects.toThrow(
        /has not been downloaded yet/
      )
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})
