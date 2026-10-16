import { afterAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createMcpToken } from '../main/settings/mcpAccess'
import { updateSettings } from '../main/settings/settingsStore'
import { addScene, addTranscriptSegment, createProject, readTranscript } from '../main/project/projectApi'
import { isKokoroDownloaded, kokoroCacheDir } from '../main/tts/kokoro/kokoroModel'
import { GOOD } from '../main/htmlScene/fixtures'

/**
 * The MCP server as an agent meets it: the built bundle, run by plain node from out/mcp, not these
 * sources. It is an ES module, where __dirname does not exist unless the build defines it — and
 * every lookup of something shipped beside it goes through __dirname. Run only once there is a
 * build to run; `npm run build` makes one.
 */
// TALKIE_MCP_BUNDLE runs the same checks against a packaged app's server, in app.asar.unpacked,
// where it is plain node and can read nothing inside the archive.
const BUNDLE = process.env.TALKIE_MCP_BUNDLE ?? join(__dirname, '..', '..', 'out', 'mcp', 'talkie-mcp.mjs')
const built = existsSync(BUNDLE) && existsSync(join(BUNDLE, '..', '..', 'html-scene', 'runtime.js'))

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

  /**
   * The server is built to out/mcp and Kokoro's worker to out/main. Looking only beside itself, the
   * server found no worker, and every narration an agent asked for ended "Kokoro stopped
   * unexpectedly (exit code 1)" — while the app, running from out/main, spoke the same words.
   * Borrows the model already downloaded; skipped where there is none.
   */
  it.skipIf(!isKokoroDownloaded())('speaks a clip in Kokoro', async () => {
    const kokoroHome = mkdtempSync(join(tmpdir(), 'talkie-built-mcp-kokoro-'))
    try {
      updateSettings({ mcp: { enabled: true }, speech: { engine: 'kokoro', voice: 'af_alloy' } }, kokoroHome)
      symlinkSync(kokoroCacheDir(homedir()), kokoroCacheDir(kokoroHome))
      const token = createMcpToken(kokoroHome)
      const projectId = createProject('Spoken', kokoroHome).id
      const slide = addScene(projectId, 'scene', { title: 'Hello', bullets: [] }, kokoroHome)
      addTranscriptSegment(projectId, { text: 'Spoken by Kokoro, asked for by an agent.', timelineItemId: slide.id }, kokoroHome)

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [BUNDLE],
        cwd: '/',
        env: { ...process.env, TALKIE_HOME: kokoroHome, TALKIE_MCP_TOKEN: token } as Record<string, string>
      })
      const client = new Client({ name: 'test', version: '1.0.0' })
      await client.connect(transport)
      try {
        const result = await client.callTool({ name: 'talkie_narrate', arguments: { projectId } })
        const content = result.content as Array<{ type: string; text?: string }>

        expect(content[0].text).toBe('Voiced 1 clip(s).')
        expect(readTranscript(projectId, kokoroHome)[0].status).toBe('narrated')
      } finally {
        await client.close()
      }
    } finally {
      rmSync(kokoroHome, { recursive: true, force: true })
    }
  }, 180_000)
})
