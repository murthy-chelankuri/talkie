import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { sayTtsProvider } from './sayTtsProvider'

describe('sayTtsProvider (real say + afconvert)', () => {
  let dir: string

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('synthesizes real speech to a real, non-empty WAV file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'demo-editor-tts-test-'))
    const outputPath = join(dir, 'segment.wav')

    await sayTtsProvider.synthesize('This is a test narration.', outputPath)

    expect(statSync(outputPath).size).toBeGreaterThan(1000)
  }, 30_000)
})
