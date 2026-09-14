import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { templateProvider } from './templateProvider'
import { anthropicProvider } from './anthropicProvider'
import { localProvider } from './localProvider'
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

    expect(text).toBe('We start on www.eenadu.net. From here we open "Politics".')
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
    // Twenty seconds at the default 170 words a minute, less the pauses between sentences.
    expect(targetWordCount(20)).toBe(52)
    expect(buildPrompt(request())).toContain('52 words at the very most')
  })

  it('never asks for so few words that the narration is a fragment', () => {
    expect(targetWordCount(0.5)).toBe(8)
  })

  it('asks for fewer words when the voice has been slowed down', () => {
    // The same clip read at 90 words a minute holds barely half of what it holds at 170, and
    // asking for the same number either way is what makes a take run past its own last frame.
    expect(targetWordCount(20, 90)).toBeLessThan(targetWordCount(20, 170))
    expect(targetWordCount(20, 300)).toBeGreaterThan(targetWordCount(20, 170))
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

  it('asks for an explanation rather than a reading of the clicks', () => {
    const prompt = buildPrompt(request())

    expect(prompt).toContain('Talk to the viewer')
    expect(prompt).toContain('Do not read out the clicks')
  })

  it('hands over what was just said, so a clip carries on rather than restarting', () => {
    const prompt = buildPrompt(request({ previousNarration: 'We opened the news site.' }))

    expect(prompt).toContain('We opened the news site.')
    expect(prompt).toContain('Carry on from what you just said')
  })

  it('treats the first clip as the opening', () => {
    expect(buildPrompt(request({ clipIndex: 1 }))).toContain('This is the opening')
  })

  it('asks the last clip to land rather than trail off', () => {
    expect(buildPrompt(request({ clipIndex: 5, clipCount: 5 }))).toContain('This is the last clip')
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
    expect(narrationProvider('local').id).toBe('local')
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

  it('local says what to start when no server is listening', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch

    const availability = await localProvider.isAvailable()

    expect(availability.available).toBe(false)
    expect(availability.reason).toContain('LM Studio, Ollama')
  })

  it('local finds whichever known runner answers first', async () => {
    globalThis.fetch = vi.fn(async (...args: unknown[]) =>
      String(args[0]).includes('1234')
        ? new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3.6-27b' }] }), { status: 200 })
        : Promise.reject(new Error('refused'))
    ) as unknown as typeof fetch

    expect(await localProvider.isAvailable()).toEqual({ available: true })
  })

  it('local never offers an embedding model, which cannot write anything', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'text-embedding-nomic-embed-text-v1.5' }] }),
        { status: 200 }
      )
    ) as unknown as typeof fetch

    const availability = await localProvider.isAvailable()

    expect(availability.available).toBe(false)
    expect(availability.reason).toContain('no usable model')
  })

  it('local sends frames as data uris in the openai shape', async () => {
    const framePath = join(baseDir, 'frame.jpg')
    writeFileSync(framePath, 'jpeg-bytes')

    const fetchMock = vi.fn(async (...args: unknown[]) =>
      String(args[0]).endsWith('/models')
        ? new Response(JSON.stringify({ data: [{ id: 'vision-model' }] }), { status: 200 })
        : new Response(
            JSON.stringify({ choices: [{ message: { content: 'A local draft.' } }] }),
            { status: 200 }
          )
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const text = await localProvider.draft(
      request({ evidence: { kind: 'video', durationSeconds: 10, actions: [], framePaths: [framePath] } })
    )

    expect(text).toBe('A local draft.')
    const call = fetchMock.mock.calls.find((args) => String(args[0]).endsWith('/chat/completions'))
    const body = JSON.parse((call?.[1] as { body: string }).body)
    expect(body.messages[0].content[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: expect.stringContaining('data:image/jpeg;base64,') }
    })
  })

  it('local explains a reasoning model that never reached an answer', async () => {
    globalThis.fetch = vi.fn(async (...args: unknown[]) =>
      String(args[0]).endsWith('/models')
        ? new Response(JSON.stringify({ data: [{ id: 'thinker' }] }), { status: 200 })
        : new Response(
            JSON.stringify({ choices: [{ message: { content: '', reasoning_content: 'thinking…' } }] }),
            { status: 200 }
          )
    ) as unknown as typeof fetch

    await expect(localProvider.draft(request())).rejects.toThrow(/spent its whole answer thinking/)
  })
})

describe('prompting for a scene written in the app', () => {
  function sceneRequest(overrides: Partial<NarrationRequest> = {}): NarrationRequest {
    return {
      projectName: 'Checkout demo',
      clipIndex: 1,
      clipCount: 1,
      evidence: {
        kind: 'diagram',
        durationSeconds: 6,
        actions: [],
        framePaths: [],
        sceneText: 'Title on screen: The flow\nThe diagram, as mermaid source:\nflowchart LR\n  A --> B'
      },
      ...overrides
    }
  }

  it('sends the diagram source, which says more than a picture of it would', () => {
    expect(buildPrompt(sceneRequest())).toContain('flowchart LR')
  })

  it('sends a slide as the words that are on it', () => {
    const prompt = buildPrompt(
      sceneRequest({
        evidence: {
          kind: 'scene',
          durationSeconds: 5,
          actions: [],
          framePaths: [],
          sceneText: 'Heading on screen: How it works\nLine on screen: Record a session'
        }
      })
    )

    expect(prompt).toContain('How it works')
    expect(prompt).toContain('Record a session')
  })

  it('tells it not to read the slide back to someone already reading it', () => {
    const prompt = buildPrompt(
      sceneRequest({
        evidence: { kind: 'scene', durationSeconds: 5, actions: [], framePaths: [], sceneText: 'Heading on screen: X' }
      })
    )

    expect(prompt).toContain('Do not say the lines back to them')
  })

  it('does not ask a one-clip demo to write an opening', () => {
    // There is nothing to open into: the clip is the whole demo, and an introduction would
    // crowd out what the scene actually says.
    expect(buildPrompt(sceneRequest())).not.toContain('This is the opening')
  })

  it('still asks for an opening when there are clips to follow', () => {
    expect(buildPrompt(sceneRequest({ clipCount: 4 }))).toContain('This is the opening')
  })

  it('puts what to do with the scene last, where it carries most weight', () => {
    const prompt = buildPrompt(sceneRequest({ clipIndex: 2, clipCount: 4 }))

    expect(prompt.lastIndexOf('the diagram')).toBeGreaterThan(prompt.indexOf('Carry on from what you just said'))
  })
})
