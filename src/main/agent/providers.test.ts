import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { templateProvider } from './templateProvider'
import { anthropicProvider } from './anthropicProvider'
import { ollamaProvider } from './ollamaProvider'
import { buildPrompt, cleanDraft, targetWordCount } from './narrationProvider'
import { narrationProvider } from './providerRegistry'
import type { NarrationRequest } from './narrationProvider'
import type { CleanAction } from './cleanActionLog'

function request(overrides: Partial<NarrationRequest> = {}): NarrationRequest {
  return {
    projectName: 'Checkout demo',
    clipIndex: 2,
    clipCount: 5,
    evidence: { kind: 'video', durationSeconds: 20, actions: [], framePaths: [] },
    ...overrides
  }
}

function action(partial: Partial<CleanAction>): CleanAction {
  return { atSeconds: 0, type: 'click', label: 'clicked "x"', ...partial }
}

describe('templateProvider', () => {
  it('is always available, which is what makes it the default', async () => {
    expect(await templateProvider.isAvailable()).toEqual({ available: true })
  })

  it('never sends anything off the machine', () => {
    expect(templateProvider.sendsDataOffMachine).toBe(false)
  })

  it('turns a recording into plain sentences', async () => {
    const text = await templateProvider.draft(
      request({
        evidence: {
          kind: 'video',
          durationSeconds: 20,
          framePaths: [],
          actions: [
            action({ type: 'navigation', label: 'www.eenadu.net' }),
            action({ type: 'click', label: 'clicked "Politics"' })
          ]
        }
      })
    )

    expect(text).toBe('We start on www.eenadu.net. Select "Politics".')
  })

  it('reads a search as a search rather than a url', async () => {
    const text = await templateProvider.draft(
      request({
        evidence: {
          kind: 'video',
          durationSeconds: 10,
          framePaths: [],
          actions: [action({ type: 'navigation', label: 'www.google.com/search — searched for "llm models"' })]
        }
      })
    )

    expect(text).toBe('We start on www.google.com/search, searching for "llm models".')
  })

  it('marks the second site as somewhere we moved on to', async () => {
    const text = await templateProvider.draft(
      request({
        evidence: {
          kind: 'video',
          durationSeconds: 20,
          framePaths: [],
          actions: [
            action({ type: 'navigation', label: 'a.test' }),
            action({ type: 'navigation', label: 'b.test' })
          ]
        }
      })
    )

    expect(text).toBe('We start on a.test. Then to b.test.')
  })

  it('says nothing it cannot know about a recording with no log', async () => {
    const text = await templateProvider.draft(request())

    expect(text).toBe('A 20-second walkthrough.')
  })

  it('places an image in the demo rather than describing what it cannot see', async () => {
    const text = await templateProvider.draft(
      request({ evidence: { kind: 'image', durationSeconds: 3, actions: [], framePaths: ['/x.png'] } })
    )

    expect(text).toBe('Slide 2 of 5.')
  })

  it('leaves the user\'s own annotations out of the spoken words', async () => {
    const text = await templateProvider.draft(
      request({
        evidence: {
          kind: 'video',
          durationSeconds: 10,
          framePaths: [],
          actions: [
            action({ type: 'navigation', label: 'a.test' }),
            action({ type: 'annotation', label: 'marked important' })
          ]
        }
      })
    )

    expect(text).toBe('We start on a.test.')
  })
})

describe('buildPrompt', () => {
  it('asks for a length the clip can actually hold', () => {
    expect(targetWordCount(20)).toBe(50)
    expect(buildPrompt(request())).toContain('About 50 words')
  })

  it('never asks for so few words that the narration is a fragment', () => {
    expect(targetWordCount(0.5)).toBe(8)
  })

  it('includes the action log with its timings', () => {
    const prompt = buildPrompt(
      request({
        evidence: {
          kind: 'video',
          durationSeconds: 20,
          framePaths: [],
          actions: [action({ atSeconds: 4.2, type: 'click', label: 'clicked "Buy"' })]
        }
      })
    )

    expect(prompt).toContain('4.2s  clicked "Buy"')
  })

  it('warns the model that the log carries advertising noise', () => {
    const prompt = buildPrompt(
      request({
        evidence: { kind: 'video', durationSeconds: 20, framePaths: [], actions: [action({})] }
      })
    )

    expect(prompt).toContain('advertising')
  })

  it('forbids inventing things, which is the failure that would matter most', () => {
    expect(buildPrompt(request())).toContain('Never invent a feature, product name, number or claim')
  })

  it('tells the model how many screenshots it is getting', () => {
    const prompt = buildPrompt(
      request({
        evidence: { kind: 'video', durationSeconds: 20, actions: [], framePaths: ['/a.jpg', '/b.jpg'] }
      })
    )

    expect(prompt).toContain('2 screenshots')
  })
})

describe('cleanDraft', () => {
  it('unwraps a fenced code block', () => {
    expect(cleanDraft('```\nHere we go.\n```')).toBe('Here we go.')
  })

  it('drops a label the model prefixed', () => {
    expect(cleanDraft('Narration: Here we go.')).toBe('Here we go.')
  })

  it('removes quotes wrapping the whole answer', () => {
    expect(cleanDraft('"Here we go."')).toBe('Here we go.')
  })

  it('leaves quotes that are part of the narration alone', () => {
    expect(cleanDraft('Select "Buy now" to continue.')).toBe('Select "Buy now" to continue.')
  })
})

describe('provider registry', () => {
  it('finds each provider by the id stored in settings', () => {
    expect(narrationProvider('template').id).toBe('template')
    expect(narrationProvider('ollama').id).toBe('ollama')
    expect(narrationProvider('anthropic').id).toBe('anthropic')
    expect(narrationProvider('claude-cli').id).toBe('claude-cli')
  })
})

describe('networked providers', () => {
  let baseDir: string
  const originalFetch = globalThis.fetch
  const originalHome = process.env.HOME

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-provider-test-'))
    // Both providers read their config from the user's settings file.
    process.env.HOME = baseDir
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.env.HOME = originalHome
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('anthropic reports what is missing rather than failing later', async () => {
    expect(await anthropicProvider.isAvailable()).toEqual({
      available: false,
      reason: 'Add an Anthropic API key in settings to use this provider.'
    })
  })

  it('anthropic refuses to draft without a key', async () => {
    await expect(anthropicProvider.draft(request())).rejects.toThrow('No Anthropic API key is set.')
  })

  it('anthropic never puts the api key into an error the ui will show', async () => {
    const { updateSettings } = await import('../settings/settingsStore')
    updateSettings({ narration: { anthropic: { apiKey: 'sk-ant-secret-value' } } }, baseDir)

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{"error":"bad key sk-ant-secret-value"}', { status: 401 })
    ) as unknown as typeof fetch

    await expect(anthropicProvider.draft(request())).rejects.toThrow(/refused the request \(401\)/)
    await expect(anthropicProvider.draft(request())).rejects.not.toThrow(/sk-ant-secret-value/)
  })

  it('anthropic sends the frames as image blocks and returns the text', async () => {
    const { updateSettings } = await import('../settings/settingsStore')
    updateSettings({ narration: { anthropic: { apiKey: 'sk-test' } } }, baseDir)

    const framePath = join(baseDir, 'frame.jpg')
    writeFileSync(framePath, 'jpeg-bytes')

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'Here we go.' }] }), { status: 200 })
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const text = await anthropicProvider.draft(
      request({ evidence: { kind: 'video', durationSeconds: 10, actions: [], framePaths: [framePath] } })
    )

    expect(text).toBe('Here we go.')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.messages[0].content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg' }
    })
  })

  it('ollama says how to install it when nothing is listening', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch

    const availability = await ollamaProvider.isAvailable()

    expect(availability.available).toBe(false)
    expect(availability.reason).toContain('ollama.com')
  })

  it('ollama names the pull command when the model is not there', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'mistral:latest' }] }), { status: 200 })
    ) as unknown as typeof fetch

    const availability = await ollamaProvider.isAvailable()

    expect(availability.reason).toBe('Ollama has no model called "llava". Run `ollama pull llava`.')
  })

  it('ollama accepts a tag that carries a version suffix', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'llava:latest' }] }), { status: 200 })
    ) as unknown as typeof fetch

    expect(await ollamaProvider.isAvailable()).toEqual({ available: true })
  })

  it('ollama returns the drafted narration', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: 'A local draft.' } }), { status: 200 })
    ) as unknown as typeof fetch

    expect(await ollamaProvider.draft(request())).toBe('A local draft.')
  })
})
