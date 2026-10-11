import { afterAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createMcpToken } from '../main/settings/mcpAccess'
import { updateSettings } from '../main/settings/settingsStore'
import { createProject } from '../main/project/projectApi'
import { GOOD } from '../main/htmlScene/fixtures'

/**
 * The MCP server as an agent meets it: the built bundle, run by plain node from out/mcp, not these
 * sources. It is an ES module, where __dirname does not exist unless the build defines it — and
 * every lookup of something shipped beside it goes through __dirname. Run only once there is a
 * build to run; `npm run build` makes one.
 */
const BUNDLE = join(__dirname, '..', '..', 'out', 'mcp', 'talkie-mcp.mjs')
const built = existsSync(BUNDLE) && existsSync(join(__dirname, '..', '..', 'out', 'html-scene', 'runtime.js'))

describe.skipIf(!built)('the built MCP server', () => {
  const home = mkdtempSync(join(tmpdir(), 'talkie-built-mcp-'))
  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it('checks an HTML scene with the runtime shipped beside it, from any working directory', async () => {
    updateSettings({ mcp: { enabled: true } }, home)
    const token = createMcpToken(home)
    const projectId = createProject('Built', home).id
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BUNDLE],
      cwd: '/',
      env: { ...process.env, TALKIE_HOME: home, TALKIE_MCP_TOKEN: token } as Record<string, string>
    })
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(transport)
    try {
      const result = await client.callTool({ name: 'talkie_add_html_scene', arguments: { projectId, title: 'Revenue', files: { 'index.html': GOOD } } })
      const content = result.content as Array<{ type: string; text?: string }>

      expect(content[0].text).toContain('The check found nothing wrong.')
      expect(content.some((part) => part.type === 'image')).toBe(true)
    } finally {
      await client.close()
    }
  }, 180_000)
})
