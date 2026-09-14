import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildRewritePrompt, rewriteText, NoRewriteProviderError } from './rewriteText'
import { NARRATION_PROVIDERS } from './providerRegistry'
import { updateSettings } from '../settings/settingsStore'

/** `complete` is optional on the interface, so spying on it needs the narrower view. */
const modelBacked = NARRATION_PROVIDERS['claude-cli'] as {
  complete: (prompt: string) => Promise<string>
}

describe('what the model is asked for', () => {
  const text = 'You click the thing and then the other thing happens, basically.'

  it('says the words are spoken, because that decides the answer', () => {
    // A rewrite that reads well on paper is the wrong answer for something read aloud.
    for (const style of ['rephrase', 'proofread', 'concise', 'fit'] as const) {
      expect(buildRewritePrompt({ text, style })).toMatch(/read aloud|speech/i)
    }
  })

  it('includes the line being rewritten', () => {
    expect(buildRewritePrompt({ text, style: 'rephrase' })).toContain(text)
  })

  it('asks proofreading to change nothing else', () => {
    const prompt = buildRewritePrompt({ text, style: 'proofread' })

    expect(prompt).toMatch(/spelling, grammar and punctuation, and nothing else/i)
    expect(prompt).toMatch(/unchanged/i)
  })

  it('gives fitting a real length to write to', () => {
    // The thing Writing Tools cannot do: narration is spoken over a clip of a known length.
    const prompt = buildRewritePrompt({ text, style: 'fit', seconds: 6 })

    expect(prompt).toContain('6.0 seconds')
    // Six seconds at the default 170 words a minute, less the pauses between sentences.
    expect(prompt).toContain('16 words')
  })

  it('still asks for something sensible when the length is unknown', () => {
    const prompt = buildRewritePrompt({ text, style: 'fit' })

    expect(prompt).toMatch(/fewer words/i)
    expect(prompt).not.toContain('undefined')
  })

  it('asks for the line alone, since the answer goes straight into the field', () => {
    expect(buildRewritePrompt({ text, style: 'rephrase' })).toMatch(/nothing else/i)
  })
})

describe('rewriting through the configured provider', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-rewrite-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('puts the model’s answer back, with any wrapping taken off', async () => {
    updateSettings({ narration: { provider: 'claude-cli' } }, baseDir)
    vi.spyOn(modelBacked, 'complete').mockResolvedValue(
      '"Click through, and the result appears."'
    )

    const answer = await rewriteText({ text: 'x', style: 'rephrase' }, baseDir)

    expect(answer).toBe('Click through, and the result appears.')
  })

  it('says which provider cannot do it, rather than failing vaguely', async () => {
    // The built-in provider writes from a template and has no model to ask.
    updateSettings({ narration: { provider: 'template' } }, baseDir)

    await expect(rewriteText({ text: 'x', style: 'rephrase' }, baseDir)).rejects.toThrow(
      NoRewriteProviderError
    )
    await expect(rewriteText({ text: 'x', style: 'rephrase' }, baseDir)).rejects.toThrow(
      /Settings → Narration/
    )
  })

  it('refuses to replace good words with nothing', async () => {
    updateSettings({ narration: { provider: 'claude-cli' } }, baseDir)
    vi.spyOn(modelBacked, 'complete').mockResolvedValue('   ')

    await expect(rewriteText({ text: 'x', style: 'rephrase' }, baseDir)).rejects.toThrow(
      /returned nothing/
    )
  })

  it('passes the clip length through to the prompt', async () => {
    updateSettings({ narration: { provider: 'claude-cli' } }, baseDir)
    const complete = vi.spyOn(modelBacked, 'complete').mockResolvedValue('Short enough.')

    await rewriteText({ text: 'x', style: 'fit', seconds: 4 }, baseDir)

    expect(complete.mock.calls[0][0]).toContain('4.0 seconds')
  })
})
