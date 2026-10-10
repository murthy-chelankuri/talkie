import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DEFAULT_KOKORO_VOICE, kokoroTtsProvider, speedFor } from './kokoroTtsProvider'
import { DEFAULT_PACE } from '../settings/schema'
import { speakWithKokoro } from './kokoro/kokoroProcess'

vi.mock('./kokoro/kokoroProcess', () => ({ speakWithKokoro: vi.fn().mockResolvedValue(2) }))

const options = { voice: 'am_michael', pace: DEFAULT_PACE, sentencePauseMs: 420, clausePauseMs: 300 }

describe('how Kokoro is told to read', () => {
  it('leaves the voice at its own speed when the slider has not been moved', () => {
    expect(speedFor(DEFAULT_PACE)).toBe(1)
  })

  it('keeps the speed within what still sounds like speech', () => {
    expect(speedFor(10)).toBe(0.5)
    expect(speedFor(1000)).toBe(2)
  })
})

describe('the Kokoro voice engine', () => {
  const originalHome = process.env.HOME
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-kokoro-tts-'))
    process.env.HOME = baseDir
    vi.mocked(speakWithKokoro).mockClear()
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('offers its download rather than an error, before the voice is on this Mac', async () => {
    expect(await kokoroTtsProvider.isAvailable()).toMatchObject({
      available: false,
      reason: expect.stringMatching(/Download the voice first — about \d+ MB, once/)
    })
  })

  it('lists its best-graded English voices first', async () => {
    const voices = await kokoroTtsProvider.voices()

    expect(voices[0]).toMatchObject({ name: 'af_heart', locale: 'en_US' })
    expect(voices.find((voice) => voice.name === 'bf_emma')?.locale).toBe('en_GB')
    // The poorly graded ones would make the app sound worse than it is.
    expect(voices.map((voice) => voice.name)).not.toContain('am_adam')
  })

  it('reads the whole take in one go, in the chosen voice and at the chosen speed', async () => {
    await kokoroTtsProvider.synthesize('First, a point. Then another.', '/tmp/take.wav', { ...options, pace: DEFAULT_PACE * 1.1 })

    expect(speakWithKokoro).toHaveBeenCalledTimes(1)
    expect(speakWithKokoro).toHaveBeenCalledWith('First, a point. Then another.', 'am_michael', 1.1, '/tmp/take.wav')
  })

  it('reads in its default voice rather than one left over from the other engine', async () => {
    await kokoroTtsProvider.synthesize('Hi.', '/tmp/take.wav', { ...options, voice: 'Samantha' })

    expect(vi.mocked(speakWithKokoro).mock.calls[0][1]).toBe(DEFAULT_KOKORO_VOICE)
  })
})
