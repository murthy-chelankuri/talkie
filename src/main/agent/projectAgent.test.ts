import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AGENT_TOOLS, agentReadiness, buildAgentPrompt, describeScenes, readStream, runProjectAgent, stepFor, toolsCalled } from './projectAgent'
import { addScene, addTranscriptSegment, createProject } from '../project/projectApi'
import { updateSettings } from '../settings/settingsStore'
import { checkMcpAccess, grantRunToken } from '../settings/mcpAccess'

function fresh(): string {
  return mkdtempSync(join(tmpdir(), 'talkie-agent-'))
}

/**
 * Tested against a stand-in `copilot`, not the real CLI — a machine that happens to have the
 * genuine one installed (as this one does) would otherwise make "not found" unwritable, and a
 * real run needs a subscription and a network. Same double `copilotCliProvider.test.ts` uses.
 */
let binDir: string
const originalPath = process.env.PATH

function installFakeCopilot(script: string): void {
  writeFileSync(join(binDir, 'copilot'), `#!/bin/sh\n${script}\n`)
  chmodSync(join(binDir, 'copilot'), 0o755)
}

function recordedArgs(): string[] {
  const path = join(binDir, 'args.txt')
  return existsSync(path) ? readFileSync(path, 'utf8').split('\0').filter(Boolean) : []
}

describe('what the project agent is allowed to do', () => {
  it('can read and change the project, but not record or export', () => {
    // Recording and exporting take minutes and are not what anyone means by "add an
    // introduction" — and a tool the agent cannot call is one a bad instruction cannot reach.
    expect(AGENT_TOOLS).toContain('talkie_timeline')
    expect(AGENT_TOOLS).toContain('talkie_set_narration')
    expect(AGENT_TOOLS).toContain('talkie_add_html_scene')
    // New scenes are HTML scenes, as in the app; classic slides and diagrams can only be edited.
    expect(AGENT_TOOLS).not.toContain('talkie_add_scene')
    expect(AGENT_TOOLS).not.toContain('talkie_add_diagram')
    // Able to tidy as well as make: a scene is always added at the end, so without move an
    // agent asked for an introduction produces one stranded after the whole demo.
    expect(AGENT_TOOLS).toContain('talkie_edit_slide')
    expect(AGENT_TOOLS).toContain('talkie_move_clip')
    expect(AGENT_TOOLS).toContain('talkie_delete_clip')
    expect(AGENT_TOOLS).not.toContain('talkie_start_recording')
    expect(AGENT_TOOLS).not.toContain('talkie_export')
    expect(AGENT_TOOLS).not.toContain('talkie_explore')
  })
})

describe('pointing the agent at scenes', () => {
  it('names each picked scene the way the timeline numbers it, with what it says now', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-agent-scenes-'))
    try {
      const { id } = createProject('Scenes', baseDir)
      addScene(id, 'scene', { title: 'Welcome', bullets: [] }, baseDir)
      const second = addScene(id, 'scene', { title: 'How it <b>works</b>', bullets: [] }, baseDir)
      addTranscriptSegment(id, { text: 'Here is how it works.', timelineItemId: second.id }, baseDir)

      const said = describeScenes(id, [second.id, 'gone'], baseDir)

      expect(said).toMatch(/this scene in particular/)
      expect(said).toContain(`Scene 2 (clip id ${second.id}): slide "How it works", 0:05–0:10. Narration now: "Here is how it works."`)
      expect(said).not.toContain('gone')
      expect(describeScenes(id, [], baseDir)).toBe('')
    } finally {
      rmSync(baseDir, { recursive: true, force: true })
    }
  })
})

describe('the run token', () => {
  it('lets the run in without disturbing the token an outside agent already holds', () => {
    // Minting one used to mean replacing the other, which would break whatever was connected.
    const baseDir = fresh()
    updateSettings({ mcp: { enabled: true, tokenHash: 'a'.repeat(64) } }, baseDir)

    const { token, withdraw } = grantRunToken(baseDir)

    expect(checkMcpAccess(token, baseDir).allowed).toBe(true)
    withdraw()
    expect(checkMcpAccess(token, baseDir).allowed).toBe(false)

    rmSync(baseDir, { recursive: true, force: true })
  })

  it('grants nothing while agent access is switched off', () => {
    // The switch is the boundary for everyone. Talkie's own agent is a child process like any
    // other and gets no way round it.
    const baseDir = fresh()
    updateSettings({ mcp: { enabled: false } }, baseDir)

    const { token } = grantRunToken(baseDir)

    expect(checkMcpAccess(token, baseDir)).toEqual({ allowed: false, refusedBecause: 'disabled' })

    rmSync(baseDir, { recursive: true, force: true })
  })
})

describe('asking the agent to change a project', () => {
  it('says what to turn on rather than failing quietly when access is off', async () => {
    const baseDir = fresh()
    const project = createProject('Off', baseDir)
    updateSettings({ mcp: { enabled: false } }, baseDir)

    const outcome = await runProjectAgent(
      { projectId: project.id, instruction: 'add an introduction', serverPath: '/tmp/fake.mjs' },
      baseDir
    )

    expect(outcome.status).toBe('failed')
    expect(outcome.status === 'failed' && outcome.reason).toContain('Settings → System')

    rmSync(baseDir, { recursive: true, force: true })
  })

  it('says a build with no server cannot do this', async () => {
    const baseDir = fresh()
    const project = createProject('No server', baseDir)
    updateSettings({ mcp: { enabled: true, tokenHash: 'a'.repeat(64) } }, baseDir)

    const outcome = await runProjectAgent(
      { projectId: project.id, instruction: 'add an introduction', serverPath: null },
      baseDir
    )

    expect(outcome.status).toBe('failed')
    expect(outcome.status === 'failed' && outcome.reason).toContain('no agent server')

    rmSync(baseDir, { recursive: true, force: true })
  })

  it('names the provider that can do this when the project is set to one that cannot', async () => {
    // Only the CLI providers bring an agent that can call tools; the rest answer one question
    // at a time, which cannot work out what a project needs and then change it.
    const baseDir = fresh()
    const project = createProject('Template', baseDir)
    updateSettings(
      { mcp: { enabled: true, tokenHash: 'a'.repeat(64) }, narration: { provider: 'template' } },
      baseDir
    )

    const outcome = await runProjectAgent(
      { projectId: project.id, instruction: 'add an introduction', serverPath: '/tmp/fake.mjs' },
      baseDir
    )

    expect(outcome.status).toBe('failed')
    expect(outcome.status === 'failed' && outcome.reason).toContain('Claude CLI')

    rmSync(baseDir, { recursive: true, force: true })
  })

  describe('with Copilot chosen as the provider', () => {
    // Against a stand-in `copilot`, not the real CLI: this machine has the genuine one
    // installed, which would make the fix invisible if the test only checked "not found", and a
    // real run needs a subscription and a network besides.
    beforeEach(() => {
      binDir = mkdtempSync(join(tmpdir(), 'talkie-agent-copilot-'))
    })

    afterEach(() => {
      process.env.PATH = originalPath
      rmSync(binDir, { recursive: true, force: true })
    })

    it('calls the Copilot CLI, not Claude, and shapes the run the way Copilot expects', async () => {
      // This used to always shell out to `claude` regardless of the setting, so a Copilot user
      // asking Talkie to change a project ran nothing at all.
      installFakeCopilot(
        `printf '%s\\0' "$@" > "${join(binDir, 'args.txt')}"\necho "Added an introduction."`
      )
      process.env.PATH = binDir

      const baseDir = fresh()
      const project = createProject('Copilot', baseDir)
      updateSettings(
        { mcp: { enabled: true, tokenHash: 'a'.repeat(64) }, narration: { provider: 'copilot-cli' } },
        baseDir
      )

      const outcome = await runProjectAgent(
        { projectId: project.id, instruction: 'add an introduction', serverPath: '/tmp/fake.mjs' },
        baseDir
      )

      expect(outcome).toMatchObject({ status: 'done', say: 'Added an introduction.' })
      expect(outcome.status === 'done' && outcome.sessionId).toBeTruthy()

      const args = recordedArgs()
      // Nothing is watching this run, and Copilot's own tools are not what was asked for.
      expect(args).toContain('--no-ask-user')
      expect(args).toContain('--disable-builtin-mcps')
      // A session id set up front, since Copilot does not hand one back on stdout the way
      // Claude does — resuming a later turn depends on Talkie having minted this itself.
      expect(args).toContain('--session-id')
      // The two flags that gate which tools reach the model disagree on how to name one.
      expect(args).toContain('talkie-talkie_set_narration')
      expect(args).toContain('talkie(talkie_set_narration)')
      // Never the Claude-shaped flags.
      expect(args).not.toContain('--allowedTools')
      expect(args).not.toContain('--strict-mcp-config')

      rmSync(baseDir, { recursive: true, force: true })
    })

    it('resumes the same session on the next turn instead of starting fresh', async () => {
      installFakeCopilot(
        `printf '%s\\0' "$@" > "${join(binDir, 'args.txt')}"\necho "Made it shorter."`
      )
      process.env.PATH = binDir

      const baseDir = fresh()
      const project = createProject('Copilot', baseDir)
      updateSettings(
        { mcp: { enabled: true, tokenHash: 'a'.repeat(64) }, narration: { provider: 'copilot-cli' } },
        baseDir
      )

      await runProjectAgent(
        { projectId: project.id, instruction: 'add an introduction', serverPath: '/tmp/fake.mjs' },
        baseDir
      )
      const firstTurnArgs = recordedArgs()
      const sessionId = firstTurnArgs[firstTurnArgs.indexOf('--session-id') + 1]

      await runProjectAgent(
        {
          projectId: project.id,
          instruction: 'make that shorter',
          serverPath: '/tmp/fake.mjs',
          resumeSessionId: sessionId
        },
        baseDir
      )

      const secondTurnArgs = recordedArgs()
      expect(secondTurnArgs).toContain('--resume')
      expect(secondTurnArgs[secondTurnArgs.indexOf('--resume') + 1]).toBe(sessionId)
      expect(secondTurnArgs).not.toContain('--session-id')

      rmSync(baseDir, { recursive: true, force: true })
    })
  })

  describe('with Claude chosen as the provider and a model set', () => {
    // Against a stand-in `claude` for the same reason as the Copilot block above: this machine
    // has the genuine CLI installed too, and PATH takes priority over findCli's fallback
    // directories, so pointing PATH at the fake is enough to keep this off the real one.
    beforeEach(() => {
      binDir = mkdtempSync(join(tmpdir(), 'talkie-agent-claude-'))
      process.env.PATH = binDir
    })

    afterEach(() => {
      process.env.PATH = originalPath
      rmSync(binDir, { recursive: true, force: true })
    })

    it('passes the chosen alias as --model', async () => {
      writeFileSync(
        join(binDir, 'claude'),
        `#!/bin/sh\nprintf '%s\\0' "$@" > "${join(binDir, 'args.txt')}"\necho '{"result":"Added an introduction."}'\n`
      )
      chmodSync(join(binDir, 'claude'), 0o755)

      const baseDir = fresh()
      const project = createProject('Claude with model', baseDir)
      updateSettings(
        {
          mcp: { enabled: true, tokenHash: 'a'.repeat(64) },
          narration: { provider: 'claude-cli', claudeCli: { model: 'haiku' } }
        },
        baseDir
      )

      const outcome = await runProjectAgent(
        { projectId: project.id, instruction: 'add an introduction', serverPath: '/tmp/fake.mjs' },
        baseDir
      )

      expect(outcome).toMatchObject({ status: 'done', say: 'Added an introduction.' })

      const args = recordedArgs()
      expect(args).toContain('--model')
      expect(args[args.indexOf('--model') + 1]).toBe('haiku')

      rmSync(baseDir, { recursive: true, force: true })
    })
  })

  describe('with Claude chosen as the provider', () => {
    beforeEach(() => {
      binDir = mkdtempSync(join(tmpdir(), 'talkie-agent-claude-'))
    })

    afterEach(() => {
      process.env.PATH = originalPath
      rmSync(binDir, { recursive: true, force: true })
    })

    it('says each thing it sets about as it starts it, and what it did at the end', async () => {
      // A run is minutes of tool calls; "Working… 140s" over all of them looked like a hang.
      const events = [
        { type: 'system', subtype: 'init', session_id: 's1' },
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__talkie__talkie_timeline', input: {} }] } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Adding one.' }, { type: 'tool_use', name: 'mcp__talkie__talkie_add_html_scene', input: {} }] } },
        { type: 'result', subtype: 'success', result: 'Added an introduction.', session_id: 's1', total_cost_usd: 0.12 }
      ]
      writeFileSync(join(binDir, 'claude'), `#!/bin/sh\n/bin/cat <<'EOF'\n${events.map((event) => JSON.stringify(event)).join('\n')}\nEOF\n`)
      chmodSync(join(binDir, 'claude'), 0o755)
      process.env.PATH = binDir

      const baseDir = fresh()
      const project = createProject('Steps', baseDir)
      updateSettings({ mcp: { enabled: true, tokenHash: 'a'.repeat(64) }, narration: { provider: 'claude-cli' } }, baseDir)

      const steps: string[] = []
      const outcome = await runProjectAgent(
        { projectId: project.id, instruction: 'add an introduction', serverPath: '/tmp/fake.mjs', onStep: (step) => steps.push(step) },
        baseDir
      )

      expect(steps).toEqual(['Reading the timeline', 'Adding a scene'])
      expect(outcome).toEqual({ status: 'done', say: 'Added an introduction.', sessionId: 's1', costUsd: 0.12 })
      rmSync(baseDir, { recursive: true, force: true })
    })

    it('says what the CLI said when it fails', async () => {
      writeFileSync(join(binDir, 'claude'), '#!/bin/sh\necho "Invalid API key · Please run /login" >&2\nexit 1\n')
      chmodSync(join(binDir, 'claude'), 0o755)
      process.env.PATH = binDir

      const baseDir = fresh()
      const project = createProject('Fails', baseDir)
      updateSettings({ mcp: { enabled: true, tokenHash: 'a'.repeat(64) }, narration: { provider: 'claude-cli' } }, baseDir)

      const outcome = await runProjectAgent({ projectId: project.id, instruction: 'x', serverPath: '/tmp/fake.mjs' }, baseDir)
      expect(outcome).toEqual({ status: 'failed', reason: 'Invalid API key · Please run /login' })
      rmSync(baseDir, { recursive: true, force: true })
    })

    it('is ready before anything is typed, and says which CLI will do the work', async () => {
      writeFileSync(join(binDir, 'claude'), '#!/bin/sh\n')
      chmodSync(join(binDir, 'claude'), 0o755)
      process.env.PATH = binDir
      const baseDir = fresh()
      updateSettings({ mcp: { enabled: true, tokenHash: 'a'.repeat(64) }, narration: { provider: 'claude-cli' } }, baseDir)

      expect(await agentReadiness('/tmp/fake.mjs', baseDir)).toEqual({ ready: true, by: 'Claude CLI' })
      rmSync(baseDir, { recursive: true, force: true })
    })
  })

  it('says where in Settings to put it right when it cannot run', async () => {
    const baseDir = fresh()
    updateSettings({ mcp: { enabled: false }, narration: { provider: 'claude-cli' } }, baseDir)
    expect(await agentReadiness('/tmp/fake.mjs', baseDir)).toMatchObject({ ready: false, fix: 'system' })

    updateSettings({ mcp: { enabled: true, tokenHash: 'a'.repeat(64) }, narration: { provider: 'template' } }, baseDir)
    expect(await agentReadiness('/tmp/fake.mjs', baseDir)).toMatchObject({ ready: false, fix: 'narration' })

    expect(await agentReadiness(null, baseDir)).toMatchObject({ ready: false, fix: null })
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('leaves no run token behind when the run fails', async () => {
    // The token is written to a file so a child process can read it. One that outlives its run
    // is just a second permanent credential.
    const baseDir = fresh()
    const project = createProject('Leak', baseDir)
    updateSettings(
      { mcp: { enabled: true, tokenHash: 'a'.repeat(64) }, narration: { provider: 'template' } },
      baseDir
    )

    await runProjectAgent(
      { projectId: project.id, instruction: 'do something', serverPath: '/tmp/fake.mjs' },
      baseDir
    )

    const { token, withdraw } = grantRunToken(baseDir)
    withdraw()
    expect(checkMcpAccess(token, baseDir).allowed).toBe(false)

    rmSync(baseDir, { recursive: true, force: true })
  })
})

describe('what the agent is told', () => {
  it('names the project it is working on, so it cannot change the wrong one', () => {
    const prompt = buildAgentPrompt('abc-123', 'add an introduction', { name: 'Ledger' })

    expect(prompt).toContain('abc-123')
    expect(prompt).toContain('Ledger')
    expect(prompt).toContain('add an introduction')
  })

  it('separates the words on a slide from the words said over it', () => {
    // Told only to set narration, the agent changes the voice and leaves the picture — which
    // reads as a preview that will not update.
    const prompt = buildAgentPrompt('abc', 'reword the opening', { name: 'L' })

    expect(prompt).toContain('talkie_edit_slide')
    expect(prompt).toContain('talkie_set_narration')
  })

  it('warns that a new scene lands at the end, which is rarely where it belongs', () => {
    expect(buildAgentPrompt('abc', 'add an introduction', { name: 'L' })).toContain('added at the end')
  })

  it('tells it how narration is timed, so it does not write flat prose over a recording', () => {
    const prompt = buildAgentPrompt('abc', 'tighten it up', { name: 'Ledger' })

    expect(prompt).toContain('[0.0]')
    expect(prompt).toContain('talkie_clip_actions')
  })

  it('passes on what the project says about itself', () => {
    const prompt = buildAgentPrompt('abc', 'redo the intro', {
      name: 'Ledger',
      context: 'Who is watching: finance teams'
    })

    expect(prompt).toContain('finance teams')
  })

  it('tells it to do what was asked and nothing else', () => {
    // A change nobody asked for is one they have to find and undo.
    expect(buildAgentPrompt('abc', 'x', { name: 'L' })).toContain('no more')
  })
})

describe('reading a streamed run', () => {
  it('names the tools an event calls, and nothing for any other line', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__talkie__talkie_move_clip' }] } })
    expect(toolsCalled(line)).toEqual(['mcp__talkie__talkie_move_clip'])
    expect(toolsCalled('{"type":"user"}')).toEqual([])
    expect(toolsCalled('not json')).toEqual([])
  })

  it('puts every tool the agent may call into words', () => {
    for (const tool of AGENT_TOOLS) expect(stepFor(`mcp__talkie__${tool}`), tool).not.toBe('Working')
  })

  it('keeps plain text when there is no result line, rather than losing what was said', () => {
    expect(readStream('Done it.\n')).toEqual({ said: 'Done it.' })
  })
})
