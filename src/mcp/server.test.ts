import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createTalkieServer } from './server'
import { readTimeline, readTranscript } from '../main/project/projectApi'
import { createMcpToken } from '../main/settings/mcpAccess'
import { updateSettings } from '../main/settings/settingsStore'

/**
 * Driven through a real MCP client rather than by calling the handlers directly, because the
 * things most likely to be wrong are the parts in between: a schema an agent cannot satisfy, a
 * tool registered under a name nothing calls, an error that arrives as a stack trace.
 */
let baseDir: string
let client: Client
let token: string

async function connect(presented: string | undefined = token): Promise<Client> {
  const server = createTalkieServer(baseDir, presented)
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
    updateSettings({ mcp: { enabled: true } }, baseDir)
    token = createMcpToken(baseDir)
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

/**
 * The gate, tested through the same client an agent uses.
 *
 * Being able to list the tools is not the same as being able to call them, and the failure worth
 * ruling out is a tool that quietly skips the check — so every registered tool is tried, rather
 * than a chosen few.
 */
describe('agent access', () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-mcp-gate-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  interface JsonSchema {
    type?: string
    const?: unknown
    enum?: unknown[]
    anyOf?: JsonSchema[]
    oneOf?: JsonSchema[]
  }

  /** The least a property will accept. */
  function valueFor(schema: JsonSchema | undefined): unknown {
    if (!schema) return 'x'
    if ('const' in schema) return schema.const
    if (schema.enum?.length) return schema.enum[0]

    // A union arrives as anyOf; any one branch satisfying it is enough.
    const branches = schema.anyOf ?? schema.oneOf
    if (branches?.length) return valueFor(branches[0])

    switch (schema.type) {
      case 'number':
      case 'integer':
        return 1
      case 'boolean':
        return false
      case 'array':
        return []
      case 'object':
        return {}
      default:
        return 'x'
    }
  }

  /** The least an argument schema will accept, so a call is judged on access and nothing else. */
  function satisfying(schema: unknown): Record<string, unknown> {
    const { properties, required } = (schema ?? {}) as {
      properties?: Record<string, JsonSchema>
      required?: string[]
    }
    const args: Record<string, unknown> = {}

    for (const name of required ?? []) args[name] = valueFor(properties?.[name])
    return args
  }

  async function refusalFrom(presented: string | undefined): Promise<string> {
    const gated = await connect(presented)
    const result = await gated.callTool({ name: 'talkie_list_projects', arguments: {} })

    expect(result.isError).toBe(true)
    const said = JSON.stringify(result.content)
    await gated.close()
    return said
  }

  it('refuses everything until the user turns it on', async () => {
    expect(await refusalFrom('any-token')).toContain('Settings')
  })

  it('refuses when it is on but no token has been made', async () => {
    updateSettings({ mcp: { enabled: true } }, baseDir)

    expect(await refusalFrom(undefined)).toContain('no access token')
  })

  it('refuses an agent that presents no token', async () => {
    updateSettings({ mcp: { enabled: true } }, baseDir)
    createMcpToken(baseDir)

    expect(await refusalFrom(undefined)).toContain('TALKIE_MCP_TOKEN')
  })

  it('refuses the wrong token', async () => {
    updateSettings({ mcp: { enabled: true } }, baseDir)
    createMcpToken(baseDir)

    expect(await refusalFrom('talkie_wrong')).toContain('not the current one')
  })

  it('gates every tool, not only the ones anyone thought to check', async () => {
    updateSettings({ mcp: { enabled: true } }, baseDir)
    createMcpToken(baseDir)
    const gated = await connect('talkie_wrong')

    for (const tool of (await gated.listTools()).tools) {
      // Called with arguments its schema accepts, so the call reaches the gate rather than
      // being turned back for the wrong reason — which would prove nothing about access.
      const result = await gated.callTool({ name: tool.name, arguments: satisfying(tool.inputSchema) })

      expect(result.isError, `${tool.name} answered without a valid token`).toBe(true)
      expect(JSON.stringify(result.content), `${tool.name} failed for some other reason`).toContain(
        'token'
      )
    }

    await gated.close()
  })

  it('stops working the moment the switch goes off, without a reconnect', async () => {
    updateSettings({ mcp: { enabled: true } }, baseDir)
    const good = createMcpToken(baseDir)
    const connected = await connect(good)

    expect((await connected.callTool({ name: 'talkie_list_projects', arguments: {} })).isError)
      .toBeFalsy()

    updateSettings({ mcp: { enabled: false } }, baseDir)

    const after = await connected.callTool({ name: 'talkie_list_projects', arguments: {} })
    expect(after.isError).toBe(true)
    await connected.close()
  })
})
