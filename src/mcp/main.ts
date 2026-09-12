import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createTalkieServer, talkieHome } from './server'
import { discardRecording } from './recordingSession'

/**
 * Talkie as an MCP server, so any agent can make a demo.
 *
 * stdio rather than a port: it is what every MCP client supports without configuration, and it
 * works whether or not the Talkie window is open — the projects are files on disk, and this
 * process reaches them through exactly the same code the app does.
 *
 * Nothing may be written to stdout but protocol messages, so every diagnostic goes to stderr.
 */
async function main(): Promise<void> {
  const server = createTalkieServer(talkieHome())

  // An agent that disconnects mid-recording would otherwise leave a browser running with a
  // half-written video behind it.
  const shutDown = (): void => {
    void discardRecording().finally(() => process.exit(0))
  }
  process.on('SIGINT', shutDown)
  process.on('SIGTERM', shutDown)

  await server.connect(new StdioServerTransport())
  console.error(`talkie-mcp ready (projects in ${talkieHome()}/Talkie)`)
}

main().catch((err) => {
  console.error('talkie-mcp could not start:', err)
  process.exit(1)
})
