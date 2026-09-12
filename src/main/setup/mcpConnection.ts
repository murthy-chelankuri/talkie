import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

export interface McpConnection {
  /** Absolute path to the built server, or null when this build has none. */
  serverPath: string | null
  /** Ready-to-paste `mcpServers` entry, the form most clients take. */
  configJson: string
  /** The one-liner for Claude Code and anything else with an `mcp add`. */
  addCommand: string
}

/**
 * How an outside agent reaches this copy of Talkie.
 *
 * The path differs between a checkout and an installed app, and it is the one thing a user
 * cannot guess, so it is worked out here and shown to them rather than documented as a shape to
 * fill in themselves.
 */
export function mcpConnection(): McpConnection {
  const serverPath = resolveServerPath()

  const config = {
    mcpServers: {
      talkie: { command: 'node', args: [serverPath ?? '<path to talkie-mcp.mjs>'] }
    }
  }

  return {
    serverPath,
    configJson: JSON.stringify(config, null, 2),
    addCommand: `claude mcp add talkie -- node ${serverPath ?? '<path to talkie-mcp.mjs>'}`
  }
}

function resolveServerPath(): string | null {
  const appPath = app.getAppPath()

  // In a packaged build the app is an asar archive and the server is unpacked beside it, because
  // an outside `node` process cannot read a file from inside the archive.
  const candidates = [
    join(appPath, 'out', 'mcp', 'talkie-mcp.mjs'),
    join(`${appPath}.unpacked`, 'out', 'mcp', 'talkie-mcp.mjs')
  ]

  return candidates.find((path) => existsSync(path)) ?? null
}
