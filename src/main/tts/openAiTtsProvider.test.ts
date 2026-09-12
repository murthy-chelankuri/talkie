import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describeDelivery, openAiTtsProvider } from './openAiTtsProvider'
import { updateSettings } from '../settings/settingsStore'

const options = { voice: 'nova', pace: 170, sentencePauseMs: 420, clausePauseMs: 300 }

describe('how a cloud voice is told to read', () => {
  it('asks for explaining rather than announcing, which is the whole difference', () => {
    expect(describeDelivery(options)).toMatch(/presenter explaining/i)
    expect(describeDelivery(options)).toMatch(/do not read it like an announcement/i)
  })

  it('turns the pace setting into words, since there is no markup to send', () => {
    expect(describeDelivery({ ...options, pace: 130 })).toContain('unhurried')
    expect(describeDelivery({ ...options, pace: 170 })).toContain('conversational')
    expect(describeDelivery({ ...options, pace: 215 })).toContain('brisk')
  })
})

describe('the cloud voice engine', () => {
  const originalFetch = globalThis.fetch
  const originalHome = process.env.HOME
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-openai-tts-'))
    process.env.HOME = baseDir
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.env.HOME = originalHome
    vi.restoreAllMocks()
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('says what to do about a missing key rather than failing at synthesis', async () => {
    expect(await openAiTtsProvider.isAvailable()).toMatchObject({
      available: false,
      reason: expect.stringContaining('API key')
    })
  })

  it('is available once a key is set', async () => {
    updateSettings({ speech: { openai: { apiKey: 'sk-test', model: 'gpt-4o-mini-tts' } } }, baseDir)

    expect(await openAiTtsProvider.isAvailable()).toMatchObject({ available: true })
  })

  it('asks for wav, because that is what the rest of the app measures and mixes', async () => {
    updateSettings({ speech: { openai: { apiKey: 'sk-test', model: 'gpt-4o-mini-tts' } } }, baseDir)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('RIFF....WAVE').buffer
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const out = join(baseDir, 'take.wav')
    await openAiTtsProvider.synthesize('Some narration.', out, options)

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.response_format).toBe('wav')
    expect(body.voice).toBe('nova')
    expect(body.input).toBe('Some narration.')
    expect(existsSync(out)).toBe(true)
    expect(readFileSync(out, 'utf8')).toContain('WAVE')
  })

  it('sends the key as a bearer token and nothing else about the machine', async () => {
    updateSettings({ speech: { openai: { apiKey: 'sk-secret', model: 'gpt-4o-mini-tts' } } }, baseDir)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await openAiTtsProvider.synthesize('x', join(baseDir, 'a.wav'), options)

    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers
    expect(headers.authorization).toBe('Bearer sk-secret')
  })

  it('passes on what the service said, which is what tells a bad key from a bad model', async () => {
    updateSettings({ speech: { openai: { apiKey: 'sk-test', model: 'nope' } } }, baseDir)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: { message: 'The model `nope` does not exist.' } })
    }) as unknown as typeof fetch

    await expect(
      openAiTtsProvider.synthesize('x', join(baseDir, 'a.wav'), options)
    ).rejects.toThrow(/does not exist/)
  })

  it('offers voices to choose from without asking the network', async () => {
    const voices = await openAiTtsProvider.voices()

    expect(voices.length).toBeGreaterThan(4)
    expect(voices.map((voice) => voice.name)).toContain('nova')
  })
})
