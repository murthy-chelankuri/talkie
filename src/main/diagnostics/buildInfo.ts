import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { checkoutRoot } from '../checkoutRoot'

/**
 * What `npm run build` was run on, written to out/build-info.json by scripts/writeBuildInfo.mjs.
 *
 * A checkout pulled without a rebuild runs the old code: the MCP server an agent starts is
 * whatever is in out/, and a fix merged and pulled still failed on another Mac in exactly the old
 * way. Comparing this with the checkout's own commit is how anyone can tell.
 */
export interface BuildInfo {
  version: string
  commit: string | null
  /** Whether the checkout had changes nobody had committed when it was built. */
  dirty: boolean
  builtAt: string
}

/** From out/main or out/mcp, the file is one folder up; from the sources, in the checkout's out/. */
export function readBuildInfo(fromDir: string = __dirname): BuildInfo | null {
  const root = checkoutRoot(fromDir)
  const candidates = [join(fromDir, '..', 'build-info.json'), ...(root ? [join(root, 'out', 'build-info.json')] : [])]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as BuildInfo
    } catch {
      return null
    }
  }
  return null
}

/** The commit a checkout is on, or null in an installed app — or where git is not to be had. */
export function checkoutCommit(fromDir: string = __dirname): string | null {
  const root = checkoutRoot(fromDir)
  if (!root) return null
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}
