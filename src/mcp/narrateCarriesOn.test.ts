import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createTalkieServer } from './server'
import { createMcpToken } from '../main/settings/mcpAccess'
import { updateSettings } from '../main/settings/settingsStore'
import { addScene, addTranscriptSegment, createProject } from '../main/project/projectApi'
import { narrateSegment } from '../main/transcript/narrate'

vi.mock('../main/transcript/narrate', () => ({ narrateSegment: vi.fn() }))

let baseDir: string
let client: Client

beforeEach(async () => {
  baseDir = mkdtempSync(join(tmpdir(), 'talkie-mcp-narrate-'))
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

function projectWithWords(count: number): { projectId: string; segmentIds: string[] } {
  const projectId = createProject('Spoken', baseDir).id
  const segmentIds = Array.from({ length: count }, (_, index) => {
    const scene = addScene(projectId, 'scene', { title: `Scene ${index + 1}`, bullets: [] }, baseDir)
    return addTranscriptSegment(projectId, { text: `Line ${index + 1}.`, timelineItemId: scene.id }, baseDir).id
  })
  return { projectId, segmentIds }
}

describe('voicing a project over MCP', () => {
  it('carries on past a clip that fails, and says which failed and why', async () => {
    const { projectId, segmentIds } = projectWithWords(3)
    vi.mocked(narrateSegment).mockImplementation(async (_project, segmentId) => {
      if (segmentId === segmentIds[0]) throw new Error('Kokoro stopped unexpectedly (exit code 1).')
      return undefined as never
    })

    const result = await client.callTool({ name: 'talkie_narrate', arguments: { projectId } })
    const said = (result.content as Array<{ text?: string }>).map((part) => part.text).join('\n')

    expect(narrateSegment).toHaveBeenCalledTimes(3)
    expect(result.isError).toBeFalsy()
    expect(said).toContain('Voiced 2 clip(s); 1 failed')
    expect(said).toContain('Kokoro stopped unexpectedly')
  })

  it('reports it as an error when no clip could be voiced', async () => {
    const { projectId } = projectWithWords(2)
    vi.mocked(narrateSegment).mockRejectedValue(new Error('Kokoro is not downloaded.'))

    const result = await client.callTool({ name: 'talkie_narrate', arguments: { projectId } })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('Kokoro is not downloaded.')
  })
})
