// `npm run doctor`: whether this checkout of Talkie can do its work, and what to do where it cannot.
// The checks run inside the built MCP server, so they test what an agent actually runs — and a
// checkout with no build is the first thing they would find, so that is said here.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'mcp', 'talkie-mcp.mjs')
if (!existsSync(server)) {
  console.log('✗ Build: this checkout has not been built.\n    → Run `npm run build`, then `npm run doctor` again.')
  process.exit(1)
}

const quick = process.argv.includes('--quick')
console.log(quick ? 'Checking Talkie…\n' : 'Checking Talkie, and speaking a line in the chosen voice…\n')
const { status } = spawnSync(process.execPath, [server, '--doctor', ...(quick ? [] : ['--speak'])], { stdio: 'inherit' })
console.log(
  status === 0
    ? '\nEverything checked is working.'
    : '\nSomething above needs fixing. If it is not clear what, use Help → Report a Problem in Talkie, or send this output.'
)
process.exit(status ?? 1)
