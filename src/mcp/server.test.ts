import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createTalkieServer } from './server'
import { addScene, addTimelineItem, readTimeline, readTranscript, writeDiagramSvg } from '../main/project/projectApi'
import type { TimelineItem } from '../main/project/timeline/schema'
import { createMcpToken } from '../main/settings/mcpAccess'
import { bandedPng } from '../main/themes/generate/testImages'
import { GOOD } from '../main/htmlScene/fixtures'
import { AGENT_TOOLS } from '../main/agent/projectAgent'
import { readTheme } from '../main/themes/themeApi'
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

/**
 * A classic slide or a diagram already in a project — made before scenes were HTML, or a theme's
 * card. Agents can no longer add them, so the tests put them there as an older project has them.
 */
function addSlide({ projectId, title, bullets, style, layout }: { projectId: string; title: string; bullets?: string[]; style?: object; layout?: string }): TimelineItem {
  return addScene(projectId, 'scene', { title, bullets: bullets ?? [], style: style ?? {}, ...(layout ? { layout } : {}) }, baseDir)
}

function addDiagram({ projectId, source }: { projectId: string; source: string }): TimelineItem {
  const src = writeDiagramSvg(projectId, '<svg xmlns="http://www.w3.org/2000/svg"><text>Drawn before</text></svg>', baseDir)
  return addScene(projectId, 'diagram', { source, style: {}, src }, baseDir)
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
        'talkie_add_html_scene',
        'talkie_set_narration',
        'talkie_draft_narration',
        'talkie_narrate',
        'talkie_export'
      ])
    )
  })

  it('makes new scenes only as HTML scenes, as the app does', async () => {
    // The app adds HTML scenes and nothing else; an agent that could still make classic slides and
    // mermaid diagrams made scenes the person had no way to add, and edited in editors they never saw.
    const names = (await client.listTools()).tools.map((tool) => tool.name)

    expect(names).toContain('talkie_add_html_scene')
    expect(names).not.toContain('talkie_add_scene')
    expect(names).not.toContain('talkie_add_diagram')
    // Slides and diagrams already in a project stay editable, as they are in the app.
    expect(names).toEqual(expect.arrayContaining(['talkie_edit_slide', 'talkie_edit_diagram']))
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

  it('reads a timeline back with its narration', async () => {
    const projectId = await newProject()
    addSlide({ projectId, title: 'One' })
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
    addSlide({ projectId, title: 'One' })
    const itemId = readTimeline(projectId, baseDir)[0].id

    await call('talkie_set_narration', { projectId, timelineItemId: itemId, text: 'First words.' })
    await call('talkie_set_narration', { projectId, timelineItemId: itemId, text: 'Second words.' })

    const transcript = readTranscript(projectId, baseDir)
    expect(transcript).toHaveLength(1)
    expect(transcript[0].text).toBe('Second words.')
  })

  it('shows the words on a slide without the markup around them', async () => {
    const projectId = await newProject()
    addSlide({ projectId, title: 'Record it <b>silent</b>' })

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
      addSlide({ projectId, title: 'Hello' })
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
      addSlide({ projectId, title: 'Hello' })
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
      addSlide({ projectId, title: 'Hello' })
      const [clip] = readTimeline(projectId, baseDir)

      await call('talkie_set_narration', { projectId, timelineItemId: clip.id, text: '[0.0] One.\n[5.0] Two.' })
      await call('talkie_set_narration', { projectId, timelineItemId: clip.id, text: 'Something else entirely.' })

      expect(readTranscript(projectId, baseDir)[0].beats).toBeUndefined()
    })

    it('lists the timings themselves, not just how many there are', async () => {
      // A count is no use for changing one line: without the times, adjusting a beat means
      // rewriting the whole take from memory, and an edit someone else made is invisible.
      const projectId = await newProject('Listing')
      addSlide({ projectId, title: 'Hello' })
      const [clip] = readTimeline(projectId, baseDir)
      await call('talkie_set_narration', { projectId, timelineItemId: clip.id, text: '[0.0] One.\n[4.0] Two.' })

      const said = await call('talkie_timeline', { projectId })

      expect(said).toContain('[0.0] One.')
      expect(said).toContain('[4.0] Two.')
    })

    it('says plainly when a take has no timings at all', async () => {
      const projectId = await newProject('Untimed listing')
      addSlide({ projectId, title: 'Hello' })
      const [clip] = readTimeline(projectId, baseDir)
      await call('talkie_set_narration', { projectId, timelineItemId: clip.id, text: 'Just words.' })

      expect(await call('talkie_timeline', { projectId })).toContain('read straight through')
    })
  })

  describe('themes', () => {
    const themeIdIn = (said: string): string => /theme id ([\w-]+)/.exec(said)?.[1] ?? ''

    it('makes a theme from fields alone, and lists it', async () => {
      const made = await call('talkie_create_theme', { name: 'Acme', tagline: 'Payments, simply' })

      expect(made).toContain('Payments, simply')
      expect(await call('talkie_list_themes')).toContain(`Acme (theme id ${themeIdIn(made)})`)
    })

    it('reads a theme back, with the projects using it', async () => {
      const themeId = themeIdIn(await call('talkie_create_theme', { name: 'Acme' }))
      const projectId = await newProject('Launch video')
      await call('talkie_apply_theme', { projectId, themeId })

      const said = await call('talkie_theme', { themeId })

      expect(said).toMatch(/brand: background #[0-9a-f]{6}/)
      expect(said).toContain('Used by: Launch video')
    })

    it('changes only what it is given, and keeps it readable', async () => {
      const themeId = themeIdIn(await call('talkie_create_theme', { name: 'Acme' }))

      const said = await call('talkie_update_theme', { themeId, tagline: 'New line', light: { background: '#ffffff', body: '#eeeeee' } })

      expect(said).toContain('Tagline: New line')
      expect(said).toMatch(/light body: #eeeeee was hard to read/)
      expect(said).toContain('Acme (theme id')
    })

    it('puts a theme on a project with its opening and closing cards, once', async () => {
      const themeId = themeIdIn(await call('talkie_create_theme', { name: 'Acme' }))
      const projectId = await newProject('Launch video')

      expect(await call('talkie_apply_theme', { projectId, themeId })).toContain('Added an opening card and a closing card')
      expect(await call('talkie_apply_theme', { projectId, themeId })).not.toContain('Added')
      expect(readTimeline(projectId, baseDir)).toHaveLength(2)
      expect(await call('talkie_apply_theme', { projectId })).toContain('back to Talkie')
    })

    it('says which projects lose a theme when it is deleted', async () => {
      const themeId = themeIdIn(await call('talkie_create_theme', { name: 'Acme' }))
      const projectId = await newProject('Launch video')
      await call('talkie_apply_theme', { projectId, themeId })

      expect(await call('talkie_delete_theme', { themeId })).toContain('Launch video went back')
      expect(await call('talkie_list_themes')).not.toContain(themeId)
    })

    it('copies a built-in theme into one that can be changed', async () => {
      const copied = await call('talkie_duplicate_theme', { themeId: 'builtin-sand', name: 'Acme' })
      const themeId = themeIdIn(copied)

      expect(copied).toContain(`Acme (theme id ${themeId})`)
      expect(await call('talkie_update_theme', { themeId, tagline: 'Payments, simply' })).toContain('Tagline: Payments, simply')
      expect(await call('talkie_update_theme', { themeId: 'builtin-sand', tagline: 'x' })).toMatch(/built into Talkie and cannot be changed/)
    })

    it.skipIf(!existsSync('/System/Library/Fonts/Supplemental/Georgia Bold.ttf'))(
      'takes a company’s own font files, names the family from them, and says which faces it has',
      async () => {
        const themeId = themeIdIn(await call('talkie_create_theme', { name: 'Acme' }))
        const dir = '/System/Library/Fonts/Supplemental/'

        const said = await call('talkie_update_theme', { themeId, headingFont: { files: [`${dir}Georgia.ttf`, `${dir}Georgia Bold.ttf`] } })

        expect(said).toContain('Headings: Georgia, Regular, Bold.')
        expect(said).toContain("Georgia (the company's own: Regular, Bold) for headings")
        expect(readTheme(themeId, baseDir).fonts.heading).toMatchObject({ family: 'Georgia', source: 'user' })

        const fake = join(baseDir, 'brand.otf')
        writeFileSync(fake, 'not a font')
        const refused = await client.callTool({ name: 'talkie_update_theme', arguments: { themeId, bodyFont: { files: [fake] } } })
        expect(refused.isError).toBe(true)
        expect(JSON.stringify(refused.content)).toMatch(/brand\.otf is not a font Talkie can read/)
      },
      60_000
    )

    it('gives a theme a logo, and moves or removes it', async () => {
      const themeId = themeIdIn(await call('talkie_create_theme', { name: 'Acme' }))
      const logo = join(baseDir, 'acme.png')
      writeFileSync(logo, bandedPng(['#e4572e']))

      expect(await call('talkie_update_theme', { themeId, logo: { path: logo, corner: 'top-left' } })).toContain('Logo: logo.png, top-left')
      expect(await call('talkie_update_theme', { themeId, logo: { onRecordings: false } })).toContain('Logo: logo.png, top-left')
      expect(readTheme(themeId, baseDir).logo?.showOn).toEqual({ recordings: false, slides: true })
      expect(await call('talkie_update_theme', { themeId, logo: { remove: true } })).toContain('Logo: none')
    })

    it('will only read a logo from an absolute path', async () => {
      const themeId = themeIdIn(await call('talkie_create_theme', { name: 'Acme' }))

      expect(await call('talkie_update_theme', { themeId, logo: { path: 'acme.png' } })).toMatch(/not an absolute path/)
    })

    it('sets a theme’s type, from Talkie’s own fonts or the person’s files', async () => {
      const themeId = themeIdIn(await call('talkie_create_theme', { name: 'Acme' }))
      // A real font, under a company's name: what is inside a file is checked now, not trusted.
      const font = join(baseDir, 'AcmeSans-400.woff2')
      copyFileSync(join(__dirname, '..', '..', 'node_modules', '@fontsource-variable', 'geist', 'files', 'geist-latin-wght-normal.woff2'), font)

      const said = await call('talkie_update_theme', {
        themeId,
        headingFont: { family: 'Geist Variable' },
        bodyFont: { family: 'Acme Sans', files: [font] }
      })

      expect(said).toContain("Fonts: Geist Variable (built in) for headings, Acme Sans (the company's own: Regular, every weight) for text")
      expect(readTheme(themeId, baseDir).fonts.body).toEqual({ family: 'Acme Sans', source: 'user', files: ['fonts/AcmeSans-400.woff2'] })
    })

    it('makes a theme from a logo file', async () => {
      const logo = join(baseDir, 'acme.png')
      writeFileSync(logo, bandedPng(['#0a6e4f', '#0a6e4f', '#ffffff']))

      const said = await call('talkie_create_theme', { name: 'Acme', file: logo })

      expect(said).toContain('Made it.')
      expect(said).toMatch(/Logo: logo\.png/)
    }, 120_000)

    it('offers the built-in themes, and will not change or delete them', async () => {
      const listed = await call('talkie_list_themes')
      const projectId = await newProject('Launch video')

      expect(listed).toContain('Midnight (built in, theme id builtin-midnight)')
      expect(await call('talkie_apply_theme', { projectId, themeId: 'builtin-midnight' })).toContain('Added an opening card')
      expect(await call('talkie_delete_theme', { themeId: 'builtin-midnight' })).toMatch(/cannot be changed or deleted/)
      expect(await call('talkie_list_themes')).toContain('builtin-midnight')
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

    it('reads back how a name is said, so it can be corrected', async () => {
      const projectId = await newProject('Spoken')

      await call('talkie_set_context', {
        projectId,
        background: 'A security product.',
        pronunciations: [{ written: 'SecOps', spoken: 'Seck-ops' }]
      })

      expect(await call('talkie_project', { projectId })).toContain('SecOps → Seck-ops')
    })

    it('keeps the pronunciations when the context is sent back without them', async () => {
      const projectId = await newProject('Kept')
      await call('talkie_set_context', {
        projectId,
        background: 'First.',
        pronunciations: [{ written: 'ITOM', spoken: 'eye tom' }]
      })

      await call('talkie_set_context', { projectId, background: 'Second.' })

      const said = await call('talkie_project', { projectId })
      expect(said).toContain('Second.')
      expect(said).toContain('ITOM → eye tom')
    })

    it('says plainly when nothing has been recorded, and what to use', async () => {
      const projectId = await newProject('Blank')

      const said = await call('talkie_project', { projectId })
      expect(said).toContain('talkie_set_context')
    })

    it('names the voices there are, and which engine they belong to', async () => {
      const said = await call('talkie_list_voices')

      expect(said).toMatch(/^Engine: /)
      expect(said).toContain('Daniel')
    }, 60_000)

    it('will not set a voice the engine does not have, since it would quietly read in another', async () => {
      const projectId = await newProject('Voiced')

      const said = await call('talkie_set_voice', { projectId, voice: 'af_heart' })

      expect(said).toMatch(/no voice called af_heart/)
      expect(await call('talkie_project', { projectId })).toContain('Voice: whatever Talkie is set to')
    }, 60_000)

    it('says which theme the project is drawn in', async () => {
      const projectId = await newProject('Themed')
      expect(await call('talkie_project', { projectId })).toContain("Theme: none — Talkie's own look")

      await call('talkie_apply_theme', { projectId, themeId: 'builtin-forest' })

      expect(await call('talkie_project', { projectId })).toContain('Theme: Forest (theme id builtin-forest)')
    })

    it('sets the voice, and says re-voicing is a separate step', async () => {
      const projectId = await newProject('Voiced')

      const said = await call('talkie_set_voice', { projectId, voice: 'Daniel' })
      expect(said).toContain('Daniel')
      expect(said).toMatch(/re-voice/i)
    })
  })

  describe('slides and cards', () => {
    it('keeps an opening card a card when its words are rewritten', async () => {
      // The cards a theme adds are slides with a layout; an edit that rebuilt the slide from its
      // words alone turned the opening card into an ordinary slide.
      const projectId = await newProject('Launch video')
      await call('talkie_apply_theme', { projectId, themeId: 'builtin-midnight' })
      const card = readTimeline(projectId, baseDir).find((item) => (item.data as { layout?: string }).layout === 'title')!

      await call('talkie_edit_slide', { projectId, timelineItemId: card.id, title: 'Welcome to Acme' })

      const data = readTimeline(projectId, baseDir).find((item) => item.id === card.id)!.data as { title: string; layout: string; style: { theme: string; align: string } }
      expect(data).toMatchObject({ title: 'Welcome to Acme', layout: 'title', style: { theme: 'brand', align: 'center' } })
    })

    it('changes one thing about a slide’s look without losing the rest', async () => {
      const projectId = await newProject('Look')
      addSlide({ projectId, title: 'Hi', style: { theme: 'light', align: 'center' } })
      const [slide] = readTimeline(projectId, baseDir)

      await call('talkie_edit_slide', { projectId, timelineItemId: slide.id, title: 'Hi', style: { size: 'large' } })

      expect((readTimeline(projectId, baseDir)[0].data as { style: object }).style).toMatchObject({ theme: 'light', align: 'center', size: 'large' })
    })
  })

  describe('HTML scenes', () => {
    const clipIdIn = (said: string): string => /clip id ([\w-]+)/.exec(said)?.[1] ?? ''
    const raw = async (name: string, args: Record<string, unknown>) =>
      (await client.callTool({ name, arguments: args })).content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>

    it('explains how to write one before anyone does', async () => {
      const guide = await call('talkie_html_scene_guide')

      expect(guide).toContain('talkie.onFrame')
      expect(guide).toContain('--talkie-heading')
      expect(guide).toContain('__TALKIE_LIB__/d3.min.js')
    })

    it('adds one, and shows the agent the frames it drew', async () => {
      const projectId = await newProject('Charts')

      const reply = await raw('talkie_add_html_scene', { projectId, title: 'Revenue', files: { 'index.html': GOOD } })

      expect(reply[0].text).toMatch(/Added "Revenue" \(clip id [\w-]+\)/)
      expect(reply[0].text).toContain('The check found nothing wrong.')
      expect(reply.filter((part) => part.type === 'image' && part.mimeType === 'image/png').length).toBeGreaterThan(0)
      expect(readTimeline(projectId, baseDir)[0].kind).toBe('html')
    }, 180_000)

    it('lists the templates with the values each reads, and starts a scene from one with its own words', async () => {
      const projectId = await newProject('Templates')

      const listed = await call('talkie_html_templates')
      expect(listed).toMatch(/^slide \(Slides\) — Slide: /m)
      expect(listed).toContain('"points":[')

      const said = await call('talkie_add_html_scene', { projectId, title: 'Why switch', template: 'slide', params: { title: 'Why teams switch' } })
      expect(said).toMatch(/Added "Why switch"/)
      const [clip] = readTimeline(projectId, baseDir)
      // The words asked for, over the template's own for whatever was not given.
      expect((clip.data as { params: Record<string, unknown> }).params).toMatchObject({
        title: 'Why teams switch',
        points: expect.arrayContaining(['Talkie writes the narration'])
      })

      expect(await call('talkie_add_html_scene', { projectId, title: 'X', template: 'nope' })).toMatch(/no template called nope.*slide/)
    }, 180_000)

    it('gives a written scene the values its page declares, so the person can change them in a form', async () => {
      const projectId = await newProject('Declared')
      const page = GOOD.replace('<head>', '<head><script type="application/json" id="talkie-values">{"quarter":"Q3"}</script>')

      await call('talkie_add_html_scene', { projectId, title: 'Revenue', files: { 'index.html': page } })

      expect((readTimeline(projectId, baseDir)[0].data as { params: Record<string, unknown> }).params).toEqual({ quarter: 'Q3' })
    }, 180_000)

    it('will only import from an absolute path', async () => {
      const projectId = await newProject('Charts')

      expect(await call('talkie_add_html_scene', { projectId, title: 'X', path: 'page.html' })).toMatch(/not an absolute path/)
    })

    it('changes only what it is given, reads back, and checks at the moments asked for', async () => {
      const projectId = await newProject('Charts')
      const id = clipIdIn(await call('talkie_add_html_scene', { projectId, title: 'Revenue', files: { 'index.html': GOOD } }))
      const src = (readTimeline(projectId, baseDir)[0].data as { src: string }).src

      await call('talkie_edit_html_scene', { projectId, timelineItemId: id, params: { quarter: 'Q4' }, style: { theme: 'light' } })
      const read = await call('talkie_html_scene', { projectId, timelineItemId: id })
      const checked = await raw('talkie_check_html_scene', { projectId, timelineItemId: id, atSeconds: [0.5] })

      expect((readTimeline(projectId, baseDir)[0].data as { src: string }).src).toBe(src)
      expect(read).toContain('look: light')
      expect(read).toContain('"quarter":"Q4"')
      expect(read).toContain('=== index.html ===')
      expect(checked.filter((part) => part.type === 'image')).toHaveLength(1)
    }, 300_000)

    it('is moved and removed like any other clip', async () => {
      const projectId = await newProject('Charts')
      addSlide({ projectId, title: 'First' })
      const id = clipIdIn(await call('talkie_add_html_scene', { projectId, title: 'Revenue', files: { 'index.html': GOOD } }))

      await call('talkie_move_clip', { projectId, timelineItemId: id, toPosition: 1 })
      expect(readTimeline(projectId, baseDir)[0].id).toBe(id)
      expect(await call('talkie_timeline', { projectId })).toContain('Revenue')

      await call('talkie_delete_clip', { projectId, timelineItemId: id })
      expect(readTimeline(projectId, baseDir).map((item) => item.kind)).toEqual(['scene'])
    }, 180_000)

    it('is all within reach of the agent inside the app', () => {
      for (const name of ['talkie_html_scene_guide', 'talkie_add_html_scene', 'talkie_html_scene', 'talkie_edit_html_scene', 'talkie_check_html_scene']) {
        expect(AGENT_TOOLS).toContain(name)
      }
    })
  })

  describe('how long a clip holds', () => {
    it('gives a slide the room it was asked for', async () => {
      // A slide is on screen for exactly as long as it is told to be, and nothing else could
      // say so — duration only ever moved as a side effect of voicing.
      const projectId = await newProject('Timing')
      addSlide({ projectId, title: 'Hold this' })
      const [slide] = readTimeline(projectId, baseDir)

      await call('talkie_set_duration', { projectId, timelineItemId: slide.id, seconds: 8 })

      expect(readTimeline(projectId, baseDir)[0].duration).toBe(240)
    })
  })

  describe('versions', () => {
    it('cuts a shorter version without losing the full one, and says what each leaves out', async () => {
      const projectId = await newProject('Cuts')
      for (const title of ['Intro', 'Deep dive', 'Close']) addSlide({ projectId, title, bullets: [] })
      const [, deep] = readTimeline(projectId, baseDir)

      await call('talkie_create_version', { projectId, name: '2-minute' })
      const said = await call('talkie_include_clip', { projectId, timelineItemId: deep.id, included: false })

      expect(said).toMatch(/"Full video" \(id full\): [\d.]+s, plays every clip/)
      expect(said).toMatch(/"2-minute" \(id [^)]+\) — being worked on: [\d.]+s, leaves out clip 2/)
      const listing = await call('talkie_timeline', { projectId })
      expect(listing).toContain('Working on the version "2-minute"')
      expect(listing).toContain('LEFT OUT of the version "2-minute"')

      // The full version is untouched, and choosing it plays everything again.
      expect(await call('talkie_choose_version', { projectId, versionId: 'full' })).toMatch(/"Full video" \(id full\) — being worked on/)
      expect(await call('talkie_timeline', { projectId })).not.toContain('LEFT OUT')
    }, 60_000)
  })

  describe('importing a slide deck', () => {
    it('turns every page of a PDF into a slide, notes and all', async () => {
      // Deck import had no tool at all because rasterising was done in the renderer. It is
      // done here now, so an agent can build a demo out of a deck it was handed.
      const projectId = await newProject('Deck')
      const dir = mkdtempSync(join(tmpdir(), 'talkie-deck-mcp-'))
      const txt = join(dir, 'deck.txt')
      const pdf = join(dir, 'deck.pdf')
      writeFileSync(txt, 'One\n\f\nTwo\n')
      writeFileSync(pdf, execFileSync('/usr/sbin/cupsfilter', [txt], { maxBuffer: 16 * 1024 * 1024 }))

      const said = await call('talkie_import_deck', { projectId, path: pdf })

      expect(said).toContain('2 slides')
      const timeline = readTimeline(projectId, baseDir)
      expect(timeline).toHaveLength(2)
      expect(timeline.every((item) => item.kind === 'image')).toBe(true)

      rmSync(dir, { recursive: true, force: true })
    }, 60_000)

    it('leaves the timeline alone when there is no deck at the path', async () => {
      // Whether a .pptx can be rendered depends on LibreOffice being installed, which is not
      // something a test should assert either way. What must hold regardless is that a failed
      // import adds nothing.
      const projectId = await newProject('Missing deck')

      const result = await client.callTool({
        name: 'talkie_import_deck',
        arguments: { projectId, path: '/tmp/there-is-no-deck-here.pdf' }
      })

      expect(result.isError).toBe(true)
      expect(readTimeline(projectId, baseDir)).toHaveLength(0)
    }, 60_000)
  })

  describe('pictures and diagrams', () => {
    it('hands back the complaint from mermaid instead of saving a diagram that will not draw', async () => {
      const projectId = await newProject('Broken diagram')

      const diagram = addDiagram({ projectId, source: 'graph LR; Alpha --> Beta' })

      const said = await call('talkie_edit_diagram', { projectId, timelineItemId: diagram.id, source: 'graph LR; A -->' })

      expect(said).toMatch(/could not be drawn/i)
      expect((readTimeline(projectId, baseDir)[0].data as { source: string }).source).toBe('graph LR; Alpha --> Beta')
    }, 120_000)

    it('redraws when the source changes, so the picture and the project agree', async () => {
      const projectId = await newProject('Redrawn')
      addDiagram({ projectId, source: 'graph LR; Alpha --> Beta' })
      const [item] = readTimeline(projectId, baseDir)
      const first = (item.data as { src: string }).src

      await call('talkie_edit_diagram', { projectId, timelineItemId: item.id, source: 'graph TD; Gamma --> Delta' })

      const data = readTimeline(projectId, baseDir)[0].data as { source: string; src: string }
      expect(data.source).toBe('graph TD; Gamma --> Delta')
      expect(data.src).not.toBe(first)
      expect(readFileSync(data.src, 'utf-8')).toContain('Gamma')
    }, 120_000)

    it('redraws a diagram in another of the theme’s looks when asked', async () => {
      const projectId = await newProject('Looks')
      await call('talkie_apply_theme', { projectId, themeId: 'builtin-midnight' })
      addDiagram({ projectId, source: 'graph LR; Alpha --> Beta' })
      const diagram = readTimeline(projectId, baseDir).find((item) => item.kind === 'diagram')!

      await call('talkie_edit_diagram', { projectId, timelineItemId: diagram.id, source: 'graph LR; Alpha --> Beta', style: { theme: 'light' } })

      const data = readTimeline(projectId, baseDir).find((item) => item.id === diagram.id)!.data as { style: { theme: string }; src: string; themeStamp: string }
      expect(data.style.theme).toBe('light')
      expect(data.themeStamp).toMatch(/light/)
      expect(readFileSync(data.src, 'utf-8')).toContain('#f5f8fc')
    }, 120_000)

    it('refuses to treat a slide as a diagram', async () => {
      const projectId = await newProject('Not a diagram')
      addSlide({ projectId, title: 'A slide' })
      const [slide] = readTimeline(projectId, baseDir)

      expect(
        await call('talkie_edit_diagram', { projectId, timelineItemId: slide.id, source: 'graph LR; A-->B' })
      ).toContain('not a diagram')
    })
  })

  describe('taking a change back', () => {
    const titleOf = (projectId: string): string => (readTimeline(projectId, baseDir)[0].data as { title: string }).title

    it('steps back its own last change', async () => {
      const projectId = await newProject('Undoable')
      const slide = addSlide({ projectId, title: 'First' })
      await call('talkie_edit_slide', { projectId, timelineItemId: slide.id, title: 'Second' })
      expect(titleOf(projectId)).toBe('Second')

      await call('talkie_undo', { projectId })

      expect(titleOf(projectId)).toBe('First')
    })

    it('puts it back again', async () => {
      const projectId = await newProject('Redoable')
      const slide = addSlide({ projectId, title: 'First' })
      await call('talkie_edit_slide', { projectId, timelineItemId: slide.id, title: 'Second' })
      await call('talkie_undo', { projectId })

      await call('talkie_redo', { projectId })

      expect(titleOf(projectId)).toBe('Second')
    })
  })

  describe('changing what a slide says', () => {
    it('rewrites the words on screen, not only the words said over them', async () => {
      // The gap this closes: the agent could change narration but not the slide, so asked to
      // reword an opening it changed the voice and left the picture — which reads as a preview
      // that will not update, because the picture genuinely never changed.
      const projectId = await newProject('Slide words')
      addSlide({ projectId, title: 'Old title', bullets: ['One', 'Two'] })
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
      addSlide({ projectId, title: 'Old', bullets: ['One', 'Two'] })
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
      // The gap this closes: adding a scene only ever appended, so an agent asked to "add an
      // introduction" produced one stranded after the whole demo and had no way to move it.
      const projectId = await newProject('Order')
      addTimelineItem(projectId, { kind: 'image', start: 0, duration: 90, data: { src: '/a.png' } }, baseDir)
      addTimelineItem(projectId, { kind: 'image', start: 90, duration: 90, data: { src: '/b.png' } }, baseDir)
      addSlide({ projectId, title: 'Ledger' })
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
      addSlide({ projectId, title: 'Wrong' })
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
      addSlide({ projectId, title: 'Hello' })
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

