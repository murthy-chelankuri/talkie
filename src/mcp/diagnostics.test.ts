import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createTalkieServer } from './server'
import { createMcpToken } from '../main/settings/mcpAccess'
import { updateSettings } from '../main/settings/settingsStore'
import { readLogTail } from '../main/diagnostics/log'
import { AGENT_TOOLS } from '../main/agent/projectAgent'

let baseDir: string
let client: Client

beforeEach(async () => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-mcp-diagnostics-'))
  updateSettings({ mcp: { enabled: true } }, baseDir)
  const server = createTalkieServer(baseDir, createMcpToken(baseDir))
  client = new Client({ name: 'test', version: '1.0.0' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

afterEach(async () => {
  await client.close()
  rmSync(baseDir, { recursive: true, force: true })
})

const said = (result: Awaited<ReturnType<Client['callTool']>>): string =>
  (result.content as Array<{ text?: string }>).map((part) => part.text ?? '').join('\n')

describe('when a tool fails over MCP', () => {
  it('writes down which tool and why, never what it was given, and points the agent at the details', async () => {
    const result = await client.callTool({
      name: 'talkie_set_narration',
      arguments: { projectId: 'no-such-project', timelineItemId: 'x', text: 'Our secret launch plan for Acme' }
    })

    expect(result.isError).toBe(true)
    expect(said(result)).toContain('talkie_diagnostics has the details')
    const log = readLogTail(50, baseDir)
    expect(log).toContain('[app] talkie_set_narration failed')
    expect(log).not.toContain('Acme')
  })

  it('gives the agent the checks, each with what to do, and the end of the log', async () => {
    await client.callTool({ name: 'talkie_timeline', arguments: { projectId: 'no-such-project' } })

    const text = said(await client.callTool({ name: 'talkie_diagnostics', arguments: {} }))

    expect(text).toMatch(/[✓✗·] Build:/)
    expect(text).toMatch(/[✓✗·] Narration voice:/)
    expect(text).toContain("The end of Talkie's log:")
    expect(text).toContain('talkie_timeline failed')
  })

  it('is one of the tools the in-app agent may use', () => {
    expect(AGENT_TOOLS).toContain('talkie_diagnostics')
  })
})
