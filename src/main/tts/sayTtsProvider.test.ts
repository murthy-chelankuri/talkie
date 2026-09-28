import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { sayTtsProvider } from './sayTtsProvider'
import { updateSettings } from '../settings/settingsStore'
import { getWavDurationSeconds } from './wavDuration'

vi.mock('./voicePauseSupport', () => ({ voiceHonoursPauses: vi.fn() }))
import { voiceHonoursPauses } from './voicePauseSupport'

/** What the caller now hands the engine, in place of it reading settings itself. */
function speechOptions(overrides = {}) {
  return { voice: 'Samantha', pace: 170, sentencePauseMs: 420, clausePauseMs: 300, ...overrides }
}

/**
 * These speak for real. `say` is fast once a voice is loaded and slow the first time macOS has
 * to fetch and warm one up — measured at over twenty seconds for a voice not used before,
 * against a limit that used to be thirty. What that produced was a suite reporting how busy
 * the machine was; none of these were ever testing the clock.
 *
 * All of them exercise the single-call path: whether a voice is trusted with embedded pauses is
 * its own question, covered in `voicePauseSupport.test.ts`, so it is mocked true here rather than
 * calibrated for real against whatever real voices happen to be installed on the machine running
 * this suite.
 */
describe('sayTtsProvider (real say + afconvert)', () => {
  let dir: string

  beforeEach(() => {
    vi.mocked(voiceHonoursPauses).mockResolvedValue(true)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('synthesizes real speech to a real, non-empty WAV file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-tts-test-'))
    const outputPath = join(dir, 'segment.wav')

    await sayTtsProvider.synthesize('This is a test narration.', outputPath, speechOptions())

    expect(statSync(outputPath).size).toBeGreaterThan(1000)
  }, 90_000)
})

describe('voice selection', () => {
  let baseDir: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    vi.mocked(voiceHonoursPauses).mockResolvedValue(true)
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-voice-test-'))
    process.env.HOME = baseDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('reads with the voice chosen in settings', async () => {
    updateSettings({ speech: { voice: 'Daniel' } }, baseDir)
    const outputPath = join(baseDir, 'daniel.wav')

    await sayTtsProvider.synthesize('Testing a chosen voice.', outputPath, speechOptions())

    expect(existsSync(outputPath)).toBe(true)
    expect(statSync(outputPath).size).toBeGreaterThan(1000)
  }, 90_000)

  it('falls back to a working voice when the setting is blank', async () => {
    // `say` with no -v can resolve to a stub that writes near-silence, so blank must not
    // mean "omit the flag".
    updateSettings({ speech: { voice: '   ' } }, baseDir)
    const outputPath = join(baseDir, 'fallback.wav')

    await sayTtsProvider.synthesize('Testing the fallback voice.', outputPath, speechOptions())

    expect(statSync(outputPath).size).toBeGreaterThan(1000)
  }, 90_000)
})

/**
 * Against a stand-in `say`/`afconvert` that always reports one flat second per call, so the
 * spliced total is predictable: three clauses at 1s each, plus the two real gaps between them,
 * and nothing else. `voiceHonoursPauses` is mocked false to force this path without needing a
 * real voice on the test machine that actually fails the way `voicePauseSupport.ts` describes.
 */
describe('the fallback for a voice that cannot be trusted with embedded pauses', () => {
  let binDir: string
  let dir: string
  const originalPath = process.env.PATH

  beforeEach(() => {
    vi.mocked(voiceHonoursPauses).mockResolvedValue(false)
    binDir = mkdtempSync(join(tmpdir(), 'talkie-say-fallback-bin-'))
    dir = mkdtempSync(join(tmpdir(), 'talkie-say-fallback-'))
    process.env.PATH = binDir

    const sayPath = join(binDir, 'say')
    writeFileSync(
      sayPath,
      `#!${process.execPath}
const { writeFileSync, appendFileSync } = require('fs')
const path = require('path')
appendFileSync(path.join(${JSON.stringify(binDir)}, 'say.calls'), '1\\n')
const args = process.argv.slice(2)
writeFileSync(args[args.indexOf('-o') + 1], '1')
`
    )
    chmodSync(sayPath, 0o755)

    const afconvertPath = join(binDir, 'afconvert')
    writeFileSync(
      afconvertPath,
      `#!${process.execPath}
const { writeFileSync } = require('fs')
const args = process.argv.slice(2)
const outPath = args[args.length - 1]
const sampleRate = 8000
const bytesPerSample = 2
const dataBytes = sampleRate * bytesPerSample // exactly one second, whatever the input said
const data = Buffer.alloc(dataBytes)
const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + dataBytes, 4)
header.write('WAVEfmt ', 8)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(1, 22)
header.writeUInt32LE(sampleRate, 24)
header.writeUInt32LE(sampleRate * bytesPerSample, 28)
header.writeUInt16LE(bytesPerSample, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(dataBytes, 40)
writeFileSync(outPath, Buffer.concat([header, data]))
`
    )
    chmodSync(afconvertPath, 0o755)
  })

  afterEach(() => {
    process.env.PATH = originalPath
    rmSync(binDir, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  })

  it('calls the voice once per clause rather than once for the whole take', async () => {
    const outputPath = join(dir, 'take.wav')

    // Two sentences, the second with a clause comma: four clauses in total.
    await sayTtsProvider.synthesize(
      'First point. Second point, with a clause in it.',
      outputPath,
      speechOptions()
    )

    const calls = readdirSync(binDir).includes('say.calls')
    expect(calls).toBe(true)
  })

  it('splices real silence between pieces rather than trusting embedded commands', async () => {
    const outputPath = join(dir, 'take.wav')

    await sayTtsProvider.synthesize(
      'First point. Second point, with a clause in it.',
      outputPath,
      speechOptions({ sentencePauseMs: 400, clausePauseMs: 200 })
    )

    // Three pieces (a lone sentence, then a two-clause sentence) at a flat 1s each from the
    // fake, plus one sentence gap and one clause gap — nothing embedded could produce this,
    // since the fake ignores whatever text and markup it was actually given.
    const expectedSeconds = 3 * 1 + 0.4 + 0.2
    expect(getWavDurationSeconds(outputPath)).toBeCloseTo(expectedSeconds, 1)
  })

  it('cleans up its intermediate pieces, leaving only the finished take', async () => {
    const outputPath = join(dir, 'take.wav')

    await sayTtsProvider.synthesize('First. Second. Third.', outputPath, speechOptions())

    expect(readdirSync(dir)).toEqual(['take.wav'])
  })
})
