import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { sayTtsProvider } from './sayTtsProvider'
import { updateSettings } from '../settings/settingsStore'

/** What the caller now hands the engine, in place of it reading settings itself. */
function speechOptions(overrides = {}) {
  return { voice: 'Samantha', pace: 170, sentencePauseMs: 420, clausePauseMs: 300, ...overrides }
}

describe('sayTtsProvider (real say + afconvert)', () => {
  let dir: string

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('synthesizes real speech to a real, non-empty WAV file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-tts-test-'))
    const outputPath = join(dir, 'segment.wav')

    await sayTtsProvider.synthesize('This is a test narration.', outputPath, speechOptions())

    expect(statSync(outputPath).size).toBeGreaterThan(1000)
  }, 30_000)
})

describe('voice selection', () => {
  let baseDir: string
  const originalHome = process.env.HOME

  beforeEach(() => {
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
  }, 30_000)

  it('falls back to a working voice when the setting is blank', async () => {
    // `say` with no -v can resolve to a stub that writes near-silence, so blank must not
    // mean "omit the flag".
    updateSettings({ speech: { voice: '   ' } }, baseDir)
    const outputPath = join(baseDir, 'fallback.wav')

    await sayTtsProvider.synthesize('Testing the fallback voice.', outputPath, speechOptions())

    expect(statSync(outputPath).size).toBeGreaterThan(1000)
  }, 30_000)
})
