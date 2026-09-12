import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildScenePrompt, parseScene, writeScene } from './writeScene'
import { updateSettings } from '../settings/settingsStore'

describe('buildScenePrompt', () => {
  const base = { instruction: 'explain the three steps', projectName: 'Checkout demo' as const }

  it('asks for a slide as json so it can be put on the timeline', () => {
    const prompt = buildScenePrompt({ ...base, kind: 'scene' })

    expect(prompt).toContain('"title"')
    expect(prompt).toContain('"bullets"')
    expect(prompt).toContain('explain the three steps')
  })

  it('sends what the slide says now, so an instruction can build on it', () => {
    const prompt = buildScenePrompt({
      ...base,
      kind: 'scene',
      current: { title: 'How it works', bullets: ['Record a session'] },
      instruction: 'make it shorter'
    })

    expect(prompt).toContain('How it works')
    expect(prompt).toContain('Record a session')
    expect(prompt).toContain('make it shorter')
  })

  it('says there is nothing yet when starting from scratch', () => {
    expect(buildScenePrompt({ ...base, kind: 'scene' })).toContain('There is no slide yet')
  })

  it('asks a diagram for mermaid, not for prose', () => {
    const prompt = buildScenePrompt({ ...base, kind: 'diagram' })

    expect(prompt).toContain('mermaid')
    expect(prompt).toContain('"source"')
  })

  it('sends the diagram as it stands when there is one', () => {
    const prompt = buildScenePrompt({
      ...base,
      kind: 'diagram',
      current: { source: 'flowchart LR; A-->B' },
      instruction: 'add a failure path'
    })

    expect(prompt).toContain('flowchart LR; A-->B')
    expect(prompt).toContain('add a failure path')
  })

  it('keeps a scene small enough to read while someone talks over it', () => {
    const prompt = buildScenePrompt({ ...base, kind: 'scene' })

    expect(prompt).toContain('At most four bullets')
  })
})

describe('parseScene', () => {
  it('reads a clean answer', () => {
    const result = parseScene('scene', '{"title":"How it works","bullets":["Record","Narrate"]}')

    expect(result).toMatchObject({ status: 'written', data: { title: 'How it works', bullets: ['Record', 'Narrate'] } })
  })

  it('finds the scene inside an answer wrapped in prose', () => {
    // Models explain themselves however firmly they are told not to.
    const result = parseScene('scene', 'Sure! Here is the slide:\n```json\n{"title":"Steps","bullets":[]}\n```\nHope that helps.')

    expect(result).toMatchObject({ status: 'written', data: { title: 'Steps', bullets: [] } })
  })

  it('fills in the missing bullets rather than failing on a title alone', () => {
    expect(parseScene('scene', '{"title":"Just this"}')).toMatchObject({
      status: 'written',
      data: { title: 'Just this', bullets: [] }
    })
  })

  it('reads a diagram answer', () => {
    const result = parseScene('diagram', '{"title":"Flow","source":"flowchart LR; A-->B"}')

    expect(result).toMatchObject({ status: 'written', data: { title: 'Flow', source: 'flowchart LR; A-->B' } })
  })

  it('refuses an answer with no scene in it at all', () => {
    expect(parseScene('scene', 'I am not sure what you mean.')).toMatchObject({ status: 'failed' })
  })

  it('refuses a scene the timeline could not show', () => {
    // A slide with no title would render as an empty frame.
    expect(parseScene('scene', '{"bullets":["one"]}')).toMatchObject({ status: 'failed' })
  })

  it('refuses broken json rather than writing it to the project', () => {
    expect(parseScene('scene', '{"title": "unclosed')).toMatchObject({ status: 'failed' })
  })
})

describe('writeScene', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-writescene-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('says plainly that the built-in provider cannot write a scene', async () => {
    // It has no model behind it: it can only describe a recording from its action log.
    const result = await writeScene(
      { kind: 'scene', instruction: 'write something', projectName: 'Demo' },
      baseDir
    )

    expect(result).toMatchObject({ status: 'failed' })
    expect((result as { reason: string }).reason).toContain('Settings')
  })

  it('passes on why a chosen provider is unavailable', async () => {
    updateSettings({ narration: { provider: 'anthropic' } }, baseDir)

    const result = await writeScene(
      { kind: 'scene', instruction: 'write something', projectName: 'Demo' },
      baseDir
    )

    expect((result as { reason: string }).reason).toContain('API key')
  })
})
