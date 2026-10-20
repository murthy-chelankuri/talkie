import { describe, expect, it, vi } from 'vitest'
import { join } from 'path'

vi.mock('electron', () => ({ app: { getAppPath: () => '/nowhere' } }))

const { resolveServerPath } = await import('./mcpConnection')

describe('the MCP server path handed to agents', () => {
  it('is the unpacked copy in a packaged app, which plain node can read', () => {
    const appPath = '/Applications/Talkie.app/Contents/Resources/app.asar'
    // Electron's fs sees into the archive, so both exist from inside the app.
    expect(resolveServerPath(appPath, () => true)).toBe(join(`${appPath}.unpacked`, 'out', 'mcp', 'talkie-mcp.mjs'))
  })

  it('is the checkout’s own build when running from source', () => {
    const appPath = '/Users/someone/talkie'
    const built = join(appPath, 'out', 'mcp', 'talkie-mcp.mjs')
    expect(resolveServerPath(appPath, (path) => path === built)).toBe(built)
  })

  it('is null where nothing is built', () => {
    expect(resolveServerPath('/Users/someone/talkie', () => false)).toBeNull()
  })
})
