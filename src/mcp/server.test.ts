import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createTalkieServer } from './server'
import { readTimeline, readTranscript } from '../main/project/projectApi'

/**
 * Driven through a real MCP client rather than by calling the handlers directly, because the
 * things most likely to be wrong are the parts in between: a schema an agent cannot satisfy, a
 * tool registered under a name nothing calls, an error that arrives as a stack trace.
 */
let baseDir: string
let client: Client

async function connect(): Promise<Client> {
  const server = createTalkieServer(baseDir)
  const connected = new Client({ name: 'test', version: '1.0.0' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()

  await Promise.all([server.connect(serverSide), connected.connect(clientSide)])
  return connected
}

/** What the agent actually reads back. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text?: string }>
  return content.map((part) => part.text ?? '').join('\n')
}

async function newProject(name = 'Demo'): Promise<string> {
  const said = await call('talkie_create_project', { name })
  return said.split('Project id: ')[1].trim()
}

describe('Talkie over MCP', () => {
  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-mcp-'))
    client = await connect()
  })

  afterEach(async () => {
    await client.close()
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('offers the tools an agent needs to make a demo', async () => {
    const names = (await client.listTools()).tools.map((tool) => tool.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'talkie_list_projects',
        'talkie_create_project',
        'talkie_timeline',
        'talkie_start_recording',
        'talkie_navigate',
        'talkie_click',
        'talkie_type',
        'talkie_stop_recording',
        'talkie_add_scene',
        'talkie_set_narration',
        'talkie_draft_narration',
        'talkie_narrate',
        'talkie_export'
      ])
    )
  })

  it('describes every tool, since the description is all an agent has to choose by', async () => {
    for (const tool of (await client.listTools()).tools) {
      expect(tool.description?.trim(), `${tool.name} has no description`).toBeTruthy()
    }
  })

  it('says so plainly when there are no projects yet', async () => {
    expect(await call('talkie_list_projects')).toContain('No projects yet')
  })

  it('creates a project and hands back the id the other tools need', async () => {
    const id = await newProject('Checkout walkthrough')

    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await call('talkie_list_projects')).toContain('Checkout walkthrough')
  })

  it('adds a slide to the timeline', async () => {
    const projectId = await newProject()

    await call('talkie_add_scene', {
      projectId,
      title: 'Why this matters',
      bullets: ['Record it silent', 'Give it a voice']
    })

    const timeline = readTimeline(projectId, baseDir)
    expect(timeline).toHaveLength(1)
    expect(timeline[0].kind).toBe('scene')
    expect((timeline[0].data as { title: string }).title).toBe('Why this matters')
  })

  it('takes a style for the slide, so an agent can match a deck', async () => {
    const projectId = await newProject()

    await call('talkie_add_scene', {
      projectId,
      title: 'Styled',
      style: { theme: 'paper', align: 'center', accent: '#f87171' }
    })

    const style = (readTimeline(projectId, baseDir)[0].data as { style: Record<string, string> }).style
    expect(style).toMatchObject({ theme: 'paper', align: 'center', accent: '#f87171' })
    // Everything not named still arrives filled in, or the renderer has nothing to draw with.
    expect(style.font).toBeTruthy()
  })

  it('reads a timeline back with its narration', async () => {
    const projectId = await newProject()
    await call('talkie_add_scene', { projectId, title: 'One' })
    const itemId = readTimeline(projectId, baseDir)[0].id

    expect(await call('talkie_timeline', { projectId })).toContain('no narration yet')

    await call('talkie_set_narration', {
      projectId,
      timelineItemId: itemId,
      text: 'This is what you are looking at.'
    })

    const described = await call('talkie_timeline', { projectId })
    expect(described).toContain('This is what you are looking at.')
    expect(described).toContain(itemId)
  })

  it('replaces narration rather than stacking a second segment on the same clip', async () => {
    const projectId = await newProject()
    await call('talkie_add_scene', { projectId, title: 'One' })
    const itemId = readTimeline(projectId, baseDir)[0].id

    await call('talkie_set_narration', { projectId, timelineItemId: itemId, text: 'First words.' })
    await call('talkie_set_narration', { projectId, timelineItemId: itemId, text: 'Second words.' })

    const transcript = readTranscript(projectId, baseDir)
    expect(transcript).toHaveLength(1)
    expect(transcript[0].text).toBe('Second words.')
  })

  it('shows the words on a slide without the markup around them', async () => {
    const projectId = await newProject()
    await call('talkie_add_scene', { projectId, title: 'Record it <b>silent</b>' })

    expect(await call('talkie_timeline', { projectId })).toContain('Record it silent')
  })

  it('tells an agent that drives the browser before starting a recording what to do', async () => {
    const result = await client.callTool({ name: 'talkie_click', arguments: { text: 'Buy' } })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('talkie_start_recording')
  })

  it('refuses to click without being told what to click', async () => {
    const result = await client.callTool({ name: 'talkie_navigate', arguments: {} })

    expect(result.isError).toBe(true)
  })

  it('reports a project that does not exist as a message, not a crash', async () => {
    const result = await client.callTool({
      name: 'talkie_timeline',
      arguments: { projectId: 'no-such-project' }
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('no-such-project')
  })

  it('says there is nothing to voice when nothing has words', async () => {
    const projectId = await newProject()

    expect(await call('talkie_narrate', { projectId })).toContain('Nothing to voice')
  })
})
