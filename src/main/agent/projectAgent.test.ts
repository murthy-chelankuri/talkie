import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AGENT_TOOLS, buildAgentPrompt, runProjectAgent } from './projectAgent'
import { createProject } from '../project/projectApi'
import { updateSettings } from '../settings/settingsStore'
import { checkMcpAccess, grantRunToken } from '../settings/mcpAccess'

function fresh(): string {
  return mkdtempSync(join(tmpdir(), 'talkie-agent-'))
}

describe('what the project agent is allowed to do', () => {
  it('can read and change the project, but not record or export', () => {
    // Recording and exporting take minutes and are not what anyone means by "add an
    // introduction" — and a tool the agent cannot call is one a bad instruction cannot reach.
    expect(AGENT_TOOLS).toContain('talkie_timeline')
    expect(AGENT_TOOLS).toContain('talkie_set_narration')
    expect(AGENT_TOOLS).toContain('talkie_add_scene')
    // Able to tidy as well as make: a scene is always added at the end, so without move an
    // agent asked for an introduction produces one stranded after the whole demo.
    expect(AGENT_TOOLS).toContain('talkie_move_clip')
    expect(AGENT_TOOLS).toContain('talkie_delete_clip')
    expect(AGENT_TOOLS).not.toContain('talkie_start_recording')
    expect(AGENT_TOOLS).not.toContain('talkie_export')
    expect(AGENT_TOOLS).not.toContain('talkie_explore')
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
