import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { readSettings } from '../settings/settingsStore'

export interface McpConnection {
  /** Absolute path to the built server, or null when this build has none. */
  serverPath: string | null
  /** Whether agent access is turned on at all. */
  enabled: boolean
  /** Whether a token exists to connect with. */
  hasToken: boolean
  /** When the current token was made, for the settings screen to show. */
  tokenCreatedAt: string
  /** Ready-to-paste `mcpServers` entry, with the token written in where one is given. */
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
 *
 * `token` is passed only in the moment just after one is created — it is never stored in a form
 * this could read back, so at any other time the snippets carry a placeholder instead.
 */
export function mcpConnection(token?: string, baseDir: string = homedir()): McpConnection {
  const serverPath = resolveServerPath()
  const { mcp } = readSettings(baseDir)

  const path = serverPath ?? '<path to talkie-mcp.mjs>'
  const secret = token ?? 'YOUR_TOKEN'

  const config = {
    mcpServers: {
      talkie: {
        command: 'node',
        args: [path],
        // An environment variable rather than an argument: arguments are visible to anything
        // that can list processes.
        env: { TALKIE_MCP_TOKEN: secret }
      }
    }
  }

  return {
    serverPath,
    enabled: mcp.enabled,
    hasToken: Boolean(mcp.tokenHash),
    tokenCreatedAt: mcp.tokenCreatedAt,
    configJson: JSON.stringify(config, null, 2),
    addCommand: `claude mcp add talkie --env TALKIE_MCP_TOKEN=${secret} -- node ${path}`
  }
}

export function resolveServerPath(appPath: string = app.getAppPath(), exists: (path: string) => boolean = existsSync): string | null {

  // In a packaged build the app is an asar archive and the server is unpacked beside it, because
  // an outside `node` process cannot read a file from inside the archive. The unpacked copy is
  // looked for first: Electron's fs reads inside the archive, so the archive's path exists from
  // here, and handed out first it gave every agent a server that closed as soon as it started.
  const candidates = [
    join(`${appPath}.unpacked`, 'out', 'mcp', 'talkie-mcp.mjs'),
    join(appPath, 'out', 'mcp', 'talkie-mcp.mjs')
  ]

  return candidates.find((path) => exists(path)) ?? null
}
