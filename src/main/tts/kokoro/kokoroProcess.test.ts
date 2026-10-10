import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isKokoroDownloaded } from './kokoroModel'
import { speakWithKokoro, stopKokoro } from './kokoroProcess'
import { readWavFormat } from '../wavDuration'

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
