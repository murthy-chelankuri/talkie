import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createTalkieServer } from './server'
import { addTimelineItem, readTimeline, readTranscript } from '../main/project/projectApi'
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

  describe('narration an agent writes over MCP', () => {
    it('keeps the timings when the lines come with them', async () => {
      // The whole reason narration keeps step with the picture is that each line says which
      // moment it belongs to. An agent that can only send prose can only produce the drift.
      const projectId = await newProject('Timed')
      await call('talkie_add_scene', { projectId, title: 'Hello' })
      const [clip] = readTimeline(projectId, baseDir)

      const said = await call('talkie_set_narration', {
        projectId,
        timelineItemId: clip.id,
        text: '[0.0] Here is the watchlist.\n[8.5] And the analysis comes back.'
      })

      expect(said).toContain('2 timed lines')
      const [segment] = readTranscript(projectId, baseDir)
      expect(segment.beats).toEqual([
        { at: 0, text: 'Here is the watchlist.' },
        { at: 8.5, text: 'And the analysis comes back.' }
      ])
      // The prose kept alongside is what the editor shows, so it is the same words unbracketed.
      expect(segment.text).toBe('Here is the watchlist. And the analysis comes back.')
    })

    it('still takes plain prose, which is read as one block', async () => {
      const projectId = await newProject('Untimed')
      await call('talkie_add_scene', { projectId, title: 'Hello' })
      const [clip] = readTimeline(projectId, baseDir)

      const said = await call('talkie_set_narration', {
        projectId,
        timelineItemId: clip.id,
        text: 'Just some words.'
      })

      expect(said).toContain('one block')
      expect(readTranscript(projectId, baseDir)[0].beats).toBeUndefined()
    })

    it('drops timings when the words are replaced with untimed ones', async () => {
      // Beats describe the words they were written for; keeping them against new words would put
      // the voice at moments chosen for sentences that are no longer there.
      const projectId = await newProject('Replaced')
      await call('talkie_add_scene', { projectId, title: 'Hello' })
      const [clip] = readTimeline(projectId, baseDir)

      await call('talkie_set_narration', { projectId, timelineItemId: clip.id, text: '[0.0] One.\n[5.0] Two.' })
      await call('talkie_set_narration', { projectId, timelineItemId: clip.id, text: 'Something else entirely.' })

      expect(readTranscript(projectId, baseDir)[0].beats).toBeUndefined()
    })

    it('lists the timings themselves, not just how many there are', async () => {
      // A count is no use for changing one line: without the times, adjusting a beat means
      // rewriting the whole take from memory, and an edit someone else made is invisible.
      const projectId = await newProject('Listing')
      await call('talkie_add_scene', { projectId, title: 'Hello' })
      const [clip] = readTimeline(projectId, baseDir)
      await call('talkie_set_narration', { projectId, timelineItemId: clip.id, text: '[0.0] One.\n[4.0] Two.' })

      const said = await call('talkie_timeline', { projectId })

      expect(said).toContain('[0.0] One.')
      expect(said).toContain('[4.0] Two.')
    })

    it('says plainly when a take has no timings at all', async () => {
      const projectId = await newProject('Untimed listing')
      await call('talkie_add_scene', { projectId, title: 'Hello' })
      const [clip] = readTimeline(projectId, baseDir)
      await call('talkie_set_narration', { projectId, timelineItemId: clip.id, text: 'Just words.' })

      expect(await call('talkie_timeline', { projectId })).toContain('read straight through')
    })
  })

  describe('knowing what the project is for', () => {
    it('reads back what it was told, so drafts use the terms the project uses', async () => {
      const projectId = await newProject('Ledger')

      await call('talkie_set_context', {
        projectId,
        background: 'Ledger grades stock calls over time.',
        audience: 'finance teams',
        neverSay: ['guaranteed returns']
      })

      const said = await call('talkie_project', { projectId })
      expect(said).toContain('Ledger grades stock calls')
      expect(said).toContain('finance teams')
      expect(said).toContain('guaranteed returns')
    })

    it('says plainly when nothing has been recorded, and what to use', async () => {
      const projectId = await newProject('Blank')

      const said = await call('talkie_project', { projectId })
      expect(said).toContain('talkie_set_context')
    })

    it('sets the voice, and says re-voicing is a separate step', async () => {
      const projectId = await newProject('Voiced')

      const said = await call('talkie_set_voice', { projectId, voice: 'Daniel' })
      expect(said).toContain('Daniel')
      expect(said).toMatch(/re-voice/i)
    })
  })

  describe('how long a clip holds', () => {
    it('gives a slide the room it was asked for', async () => {
      // A slide is on screen for exactly as long as it is told to be, and nothing else could
      // say so — duration only ever moved as a side effect of voicing.
      const projectId = await newProject('Timing')
      await call('talkie_add_scene', { projectId, title: 'Hold this' })
      const [slide] = readTimeline(projectId, baseDir)

      await call('talkie_set_duration', { projectId, timelineItemId: slide.id, seconds: 8 })

      expect(readTimeline(projectId, baseDir)[0].duration).toBe(240)
    })
  })

  describe('pictures and diagrams', () => {
    it('writes a diagram as source, and says it is drawn later', async () => {
      // Mermaid needs a browser and this does not run in one, so the source is what is stored
      // and Talkie draws it when it next opens the project.
      const projectId = await newProject('Drawn')

      const said = await call('talkie_add_diagram', {
        projectId,
        source: 'graph LR; A[Client] --> B[API]',
        title: 'How it fits together'
      })

      expect(said).toMatch(/drawn the next time/i)
      const [item] = readTimeline(projectId, baseDir)
      expect(item.kind).toBe('diagram')
      expect(item.data).toMatchObject({ source: 'graph LR; A[Client] --> B[API]' })
    })

    it('drops the old drawing when the source changes, so the two cannot disagree', async () => {
      const projectId = await newProject('Redrawn')
      await call('talkie_add_diagram', { projectId, source: 'graph LR; A --> B' })
      const [item] = readTimeline(projectId, baseDir)
      // Stand in for the app having drawn it once already.
      await call('talkie_edit_diagram', { projectId, timelineItemId: item.id, source: 'graph TD; C --> D' })

      const data = readTimeline(projectId, baseDir)[0].data as { source: string; src?: string }
      expect(data.source).toBe('graph TD; C --> D')
      expect(data.src).toBeUndefined()
    })

    it('refuses to treat a slide as a diagram', async () => {
      const projectId = await newProject('Not a diagram')
      await call('talkie_add_scene', { projectId, title: 'A slide' })
      const [slide] = readTimeline(projectId, baseDir)

      expect(
        await call('talkie_edit_diagram', { projectId, timelineItemId: slide.id, source: 'graph LR; A-->B' })
      ).toContain('not a diagram')
    })
  })

  describe('taking a change back', () => {
    it('steps back its own last change', async () => {
      const projectId = await newProject('Undoable')
      await call('talkie_add_scene', { projectId, title: 'First' })
      await call('talkie_add_scene', { projectId, title: 'Second' })
      expect(readTimeline(projectId, baseDir)).toHaveLength(2)

      await call('talkie_undo', { projectId })

      expect(readTimeline(projectId, baseDir)).toHaveLength(1)
    })

    it('puts it back again', async () => {
      const projectId = await newProject('Redoable')
      await call('talkie_add_scene', { projectId, title: 'Only' })
      await call('talkie_undo', { projectId })

      await call('talkie_redo', { projectId })

      expect(readTimeline(projectId, baseDir)).toHaveLength(1)
    })
  })

  describe('changing what a slide says', () => {
    it('rewrites the words on screen, not only the words said over them', async () => {
      // The gap this closes: the agent could change narration but not the slide, so asked to
      // reword an opening it changed the voice and left the picture — which reads as a preview
      // that will not update, because the picture genuinely never changed.
      const projectId = await newProject('Slide words')
      await call('talkie_add_scene', { projectId, title: 'Old title', bullets: ['One', 'Two'] })
      const [slide] = readTimeline(projectId, baseDir)

      const said = await call('talkie_edit_slide', {
        projectId,
        timelineItemId: slide.id,
        title: 'New title'
      })

      expect(said).toContain('New title')
      expect(readTimeline(projectId, baseDir)[0].data).toMatchObject({ title: 'New title' })
    })

    it('keeps the lines it was not asked about', async () => {
      // Leaving the bullets out of a retitle should not silently empty the slide.
      const projectId = await newProject('Keep bullets')
      await call('talkie_add_scene', { projectId, title: 'Old', bullets: ['One', 'Two'] })
      const [slide] = readTimeline(projectId, baseDir)

      await call('talkie_edit_slide', { projectId, timelineItemId: slide.id, title: 'New' })

      expect(readTimeline(projectId, baseDir)[0].data).toMatchObject({ bullets: ['One', 'Two'] })
    })

    it('says a recording has no words to rewrite, and what to use instead', async () => {
      const projectId = await newProject('Not a slide')
      addTimelineItem(projectId, { kind: 'video', start: 0, duration: 90, data: { src: '/v.mp4' } }, baseDir)
      const [clip] = readTimeline(projectId, baseDir)

      const said = await call('talkie_edit_slide', {
        projectId,
        timelineItemId: clip.id,
        title: 'Nope'
      })

      expect(said).toContain('only a slide')
      expect(said).toContain('talkie_set_narration')
    })
  })

  describe('rearranging a project over MCP', () => {
    it('lifts a scene added at the end to the front, where an introduction belongs', async () => {
      // The gap this closes: talkie_add_scene only ever appends, so an agent asked to "add an
      // introduction" produced one stranded after the whole demo and had no way to move it.
      const projectId = await newProject('Order')
      addTimelineItem(projectId, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
      addTimelineItem(projectId, { kind: 'image', start: 90, duration: 90, data: { src: '/b.png' } }, baseDir)
      await call('talkie_add_scene', { projectId, title: 'Ledger' })
      const intro = readTimeline(projectId, baseDir)[2]

      const said = await call('talkie_move_clip', {
        projectId,
        timelineItemId: intro.id,
        toPosition: 1
      })

      expect(said).toContain('position 1')
      expect(readTimeline(projectId, baseDir).map((item) => item.id)[0]).toBe(intro.id)
    })

    it('closes the gaps so the project still plays end to end', async () => {
      const projectId = await newProject('Gapless')
      addTimelineItem(projectId, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
      addTimelineItem(projectId, { kind: 'image', start: 90, duration: 60, data: { src: '/b.png' } }, baseDir)
      addTimelineItem(projectId, { kind: 'image', start: 150, duration: 30, data: { src: '/c.png' } }, baseDir)
      const last = readTimeline(projectId, baseDir)[2]

      await call('talkie_move_clip', { projectId, timelineItemId: last.id, toPosition: 1 })

      let cursor = 0
      for (const item of readTimeline(projectId, baseDir)) {
        expect(item.start).toBe(cursor)
        cursor += item.duration
      }
    })

    it('says a position is outside the project rather than dropping the clip', async () => {
      const projectId = await newProject('Outside')
      addTimelineItem(projectId, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
      const [only] = readTimeline(projectId, baseDir)

      const result = await client.callTool({
        name: 'talkie_move_clip',
        arguments: { projectId, timelineItemId: only.id, toPosition: 9 }
      })

      expect(result.isError).toBe(true)
      expect(readTimeline(projectId, baseDir)).toHaveLength(1)
    })

    it('takes back a scene it should not have added', async () => {
      // Without this the agent could make a mess and not tidy it.
      const projectId = await newProject('Undo it')
      await call('talkie_add_scene', { projectId, title: 'Wrong' })
      const [added] = readTimeline(projectId, baseDir)

      const said = await call('talkie_delete_clip', { projectId, timelineItemId: added.id })

      expect(said).toContain('Deleted')
      expect(readTimeline(projectId, baseDir)).toHaveLength(0)
    })

    it('refuses a clip id that is not there', async () => {
      const projectId = await newProject('Missing clip')

      expect(await call('talkie_delete_clip', { projectId, timelineItemId: 'nope' })).toContain(
        'No clip found'
      )
    })
  })

  describe('reading and cutting a recorded clip over MCP', () => {
    it('says a slide has nothing happening in it rather than failing', async () => {
      const projectId = await newProject('Slide')
      await call('talkie_add_scene', { projectId, title: 'Hello' })
      const [clip] = readTimeline(projectId, baseDir)

      expect(await call('talkie_clip_actions', { projectId, timelineItemId: clip.id })).toContain(
        'no recorded actions'
      )
    })

    it('refuses a clip id that is not there instead of throwing at the agent', async () => {
      const projectId = await newProject('Missing')

      expect(await call('talkie_clip_actions', { projectId, timelineItemId: 'nope' })).toContain(
        'No clip found'
      )
      expect(await call('talkie_split_clip', { projectId, timelineItemId: 'nope', atSeconds: 1 })).toContain(
        'No clip found'
      )
    })

    it('says so in seconds when asked to cut past the end of a clip', async () => {
      // The API underneath counts frames on the whole project timeline, which is not a thing an
      // agent that asked in seconds inside one clip could do anything with.
      const projectId = await newProject('Past the end')
      addTimelineItem(projectId, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
      const [clip] = readTimeline(projectId, baseDir)

      const said = await call('talkie_split_clip', { projectId, timelineItemId: clip.id, atSeconds: 99 })

      expect(said).toContain('only 3.0s long')
      expect(readTimeline(projectId, baseDir)).toHaveLength(1)
    })

    it('cuts a clip in two at a moment inside it, measured from the clip own start', async () => {
      // An agent knows where it is in a clip, not where that clip sits on the project timeline.
      const projectId = await newProject('Split')
      addTimelineItem(projectId, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
      addTimelineItem(
        projectId,
        { kind: 'video', start: 90, duration: 600, data: { src: '/v.mp4', trimBefore: 30, trimAfter: 630 } },
        baseDir
      )
      const recorded = readTimeline(projectId, baseDir)[1]

      const said = await call('talkie_split_clip', {
        projectId,
        timelineItemId: recorded.id,
        atSeconds: 5
      })

      expect(said).toContain('Split into two clips')
      const [, first, second] = readTimeline(projectId, baseDir)
      expect(first.duration).toBe(150)
      expect(second.duration).toBe(450)
      // Both halves play their own stretch of the one file, end to end.
      expect(first.data).toMatchObject({ trimBefore: 30, trimAfter: 180 })
      expect(second.data).toMatchObject({ trimBefore: 180, trimAfter: 630 })
    })
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

